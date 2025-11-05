import os
import time
import threading
from typing import Any, Dict

from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

# Backend CAN layers
from CANIF.CANInterface import CANInterface
from CANTP.CANTP import CANTP
from COMDIAG.ComDia import ComDiag
from COMMON.Cast import Hex, HexArr2Str


def _coerce_number(value):
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        value = value.strip()
    except AttributeError:
        return None
    if not value:
        return None
    try:
        if value.startswith("0x") or value.startswith("0X"):
            return int(value, 16)
        if value.startswith("0b") or value.startswith("0B"):
            return int(value, 2)
        if value.startswith("0o") or value.startswith("0O"):
            return int(value, 8)
        if "." in value or "e" in value.lower():
            return float(value)
        return int(value)
    except ValueError:
        try:
            return float(value)
        except ValueError:
            return None


def _physical_to_raw(signal, physical):
    if physical is None:
        return None
    if not isinstance(physical, (int, float)):
        physical = _coerce_number(physical)
    if physical is None:
        return None
    scale = signal.scale if signal.scale not in (None, 0) else 1
    offset = signal.offset or 0
    if scale == 0:
        return physical
    try:
        raw = (physical - offset) / scale
    except TypeError:
        return None
    if getattr(signal, "is_float", False):
        return raw
    return int(round(raw))


def _raw_to_physical(signal, raw):
    if raw is None:
        return None
    if not isinstance(raw, (int, float)):
        raw = _coerce_number(raw)
    if raw is None:
        return None
    scale = signal.scale if signal.scale not in (None, 0) else 1
    offset = signal.offset or 0
    try:
        return raw * scale + offset
    except TypeError:
        return None


def _normalize_physical(signal, value):
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if getattr(signal, "is_float", False):
        return numeric
    if numeric.is_integer():
        return int(numeric)
    return int(round(numeric))


app = Flask(__name__, static_folder="static", template_folder="templates")
socketio = SocketIO(app, cors_allowed_origins="*")


class AppState:
    def __init__(self) -> None:
        self.canif: CANInterface | None = None
        self.cantp: CANTP | None = None
        self.diag: ComDiag | None = None

        self.trace_thread: threading.Thread | None = None
        self.trace_running: bool = False
        self.decode_enabled: bool = True


state = AppState()


def _msg_to_dict(msg) -> Dict[str, Any]:
    try:
        data_str = HexArr2Str(msg.data)
    except Exception:
        data_str = ""
    decoded = None
    if state.decode_enabled and state.canif and state.canif.dbc:
        try:
            decoded = state.canif.dbc.decode_message(msg.arbitration_id, msg.data)
        except Exception:
            decoded = None
    return {
        "ts": time.time(),
        "id": Hex(msg.arbitration_id),
        "dlc": len(msg.data) if getattr(msg, "data", None) is not None else 0,
        "data": data_str,
        "is_extended": bool(getattr(msg, "is_extended_id", False)),
        "is_fd": bool(getattr(msg, "is_fd", False)),
        "decoded": decoded,
    }


def _trace_worker():
    while state.trace_running and state.canif and state.canif.reader:
        try:
            msg = state.canif.reader.get_from_default(pop=True)
        except Exception:
            msg = None
        if msg is None:
            # Yield CPU a bit
            socketio.sleep(0.01)
            continue
        try:
            socketio.emit("trace", _msg_to_dict(msg))
        except Exception:
            # Ignore emit failures to keep loop healthy
            pass


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/init", methods=["POST"])
def api_init():
    payload = request.get_json(force=True, silent=True) or {}
    device = payload.get("device", "PCAN")
    channel = int(payload.get("channel", 0))
    is_fd = bool(payload.get("is_fd", False))
    padding = payload.get("padding", "00")
    dbc_path = payload.get("dbc_path")

    # Shutdown existing if any
    if state.canif and state.canif.bus:
        try:
            state.canif.shutdown_bus()
        except Exception:
            pass

    state.canif = CANInterface(device=device, is_fd=is_fd, channel=channel, padding=padding, dbc_path=dbc_path)
    state.canif.initialize_bus()
    state.cantp = CANTP(CanIF=state.canif, padding=padding)
    state.diag = None

    return jsonify({"ok": True, "device": device, "channel": channel, "is_fd": is_fd, "dbc_loaded": bool(state.canif.dbc)})


@app.route("/api/dbc/messages", methods=["GET"])
def api_dbc_messages():
    if not state.canif or not state.canif.dbc:
        return jsonify({"ok": False, "error": "DBC not loaded"}), 400
    out = []
    try:
        for m in state.canif._Messages():
            out.append({
                "name": getattr(m, "name", ""),
                "id": getattr(m, "frame_id", 0),
                "id_hex": Hex(getattr(m, "frame_id", 0)),
                "dlc": getattr(m, "length", 8),
                "cycle_time": getattr(m, "cycle_time", None),
                "is_extended": getattr(m, "is_extended_frame", False),
                "senders": getattr(m, "senders", []),
                "signals": [s.name for s in getattr(m, "signals", [])],
            })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    return jsonify({"ok": True, "messages": out})


@app.route("/api/dbc/nodes", methods=["GET"])
def api_dbc_nodes():
    if not state.canif or not state.canif.dbc:
        return jsonify({"ok": False, "error": "DBC not loaded"}), 400
    try:
        nodes = state.canif.get_nodes_in_DBC()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    return jsonify({"ok": True, "nodes": nodes})


@app.route("/api/dbc/message/<string:msg_name>", methods=["GET"])
def api_dbc_message_current(msg_name: str):
    if not state.canif or not state.canif.dbc:
        return jsonify({"ok": False, "error": "DBC not loaded"}), 400
    try:
        curr = state.canif.get_current_signals_queue(msg_name)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True, "signals": curr})


@app.route("/api/dbc/message_info/<string:msg_name>", methods=["GET"])
def api_dbc_message_info(msg_name: str):
    if not state.canif or not state.canif.dbc:
        return jsonify({"ok": False, "error": "DBC not loaded"}), 400
    try:
        message = state.canif.get_msg_att(msg_name)
        curr = state.canif.get_current_signals_queue(msg_name)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    signals = []
    for sig in getattr(message, "signals", []):
        physical = curr.get(sig.name) if isinstance(curr, dict) else None
        raw_val = _physical_to_raw(sig, physical)
        signals.append({
            "name": sig.name,
            "physical": physical,
            "raw": raw_val,
            "scale": sig.scale,
            "offset": sig.offset,
            "minimum": sig.minimum,
            "maximum": sig.maximum,
            "unit": sig.unit,
            "choices": sig.choices,
            "is_float": getattr(sig, "is_float", False),
        })

    running = False
    try:
        msg_id = message.frame_id
        running = bool(getattr(state.canif.scheduler, "tasks", {}).get(msg_id))
    except Exception:
        pass

    return jsonify({
        "ok": True,
        "message": {
            "name": message.name,
            "id": message.frame_id,
            "id_hex": Hex(message.frame_id),
            "cycle_time": getattr(message, "cycle_time", None),
            "signals": signals,
            "running": running,
        },
    })


@app.route("/api/send/raw", methods=["POST"])
def api_send_raw():
    if not state.canif:
        return jsonify({"ok": False, "error": "CAN not initialized"}), 400
    payload = request.get_json(force=True, silent=True) or {}
    can_id = str(payload.get("id", "7E0")).strip()
    data = str(payload.get("data", "")).strip()
    is_fd = payload.get("is_fd")
    ok = state.canif.write(can_id, data, is_fd=is_fd)
    return jsonify({"ok": bool(ok)})


@app.route("/api/periodic/start", methods=["POST"])
def api_periodic_start():
    if not state.canif:
        return jsonify({"ok": False, "error": "CAN not initialized"}), 400
    payload = request.get_json(force=True, silent=True) or {}
    msg = payload.get("message")
    period = payload.get("period")
    duration = payload.get("duration")
    is_fd = payload.get("is_fd")

    try:
        # allow name or id
        state.canif.start_periodic_by_message(msg, period=period, duration=duration, is_fd=is_fd)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/periodic/stop", methods=["POST"])
def api_periodic_stop():
    if not state.canif:
        return jsonify({"ok": False, "error": "CAN not initialized"}), 400
    payload = request.get_json(force=True, silent=True) or {}
    msg = payload.get("message")
    try:
        # Work around CANInterface.stop_periodic issue by going direct
        try:
            # If a name is provided, resolve to frame_id
            if isinstance(msg, str) and not msg.lower().startswith("0x") and not all(c in "0123456789abcdefABCDEF" for c in msg):
                m = state.canif.get_msg_att(msg)
                msg_id = m.frame_id
            else:
                msg_id = int(str(msg), 16) if isinstance(msg, str) else int(msg)
        except Exception:
            m = state.canif.get_msg_att(msg)
            msg_id = m.frame_id
        state.canif.scheduler.stop_message(msg_id)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/periodic/update", methods=["POST"])
def api_periodic_update():
    if not state.canif or not state.canif.dbc:
        return jsonify({"ok": False, "error": "DBC not loaded"}), 400
    payload = request.get_json(force=True, silent=True) or {}
    msg_name = payload.get("message_name")
    signals = payload.get("signals") or {}
    try:
        state.canif.update_periodic(msg_name, signals)
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/stim/update", methods=["POST"])
def api_stim_update():
    if not state.canif or not state.canif.dbc:
        return jsonify({"ok": False, "error": "DBC not loaded"}), 400
    payload = request.get_json(force=True, silent=True) or {}
    msg_name = payload.get("message_name")
    signal_payloads = payload.get("signals") or {}
    if not msg_name:
        return jsonify({"ok": False, "error": "Missing message_name"}), 400

    try:
        message = state.canif.get_msg_att(msg_name)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

    signal_lookup = {sig.name: sig for sig in getattr(message, "signals", [])}
    updates = {}

    for sig_name, values in signal_payloads.items():
        sig = signal_lookup.get(sig_name)
        if not sig:
            continue
        phys_value = values.get("physical") if isinstance(values, dict) else None
        raw_value = values.get("raw") if isinstance(values, dict) else None
        phys = _coerce_number(phys_value)
        raw = _coerce_number(raw_value)
        if phys is None and raw is None:
            continue
        if phys is None:
            phys = _raw_to_physical(sig, raw)
        updates[sig_name] = _normalize_physical(sig, phys)

    if updates:
        try:
            state.canif.update_periodic(msg_name, updates)
        except Exception as e:
            return jsonify({"ok": False, "error": f"Failed to update signals: {e}"}), 400

    msg_id = getattr(message, "frame_id", None)
    scheduler = getattr(state.canif, "scheduler", None)
    running = bool(getattr(scheduler, "tasks", {}).get(msg_id)) if scheduler and msg_id is not None else False
    started = False

    if not running:
        try:
            state.canif.start_periodic_by_message(msg_name)
            started = True
            running = True
        except Exception as e:
            return jsonify({"ok": False, "error": f"Failed to start periodic: {e}"}), 400

    return jsonify({"ok": True, "running": running, "started": started})


@app.route("/api/diag/configure", methods=["POST"])
def api_diag_configure():
    if not state.canif:
        return jsonify({"ok": False, "error": "CAN not initialized"}), 400
    payload = request.get_json(force=True, silent=True) or {}
    ecu_raw = payload.get("ecu_id", "7E0")
    tester_raw = payload.get("tester_id", "7E8")
    dll_raw = payload.get("dll")
    ecu_id = str(ecu_raw).strip().upper() if ecu_raw is not None else "7E0"
    tester_id = str(tester_raw).strip().upper() if tester_raw is not None else "7E8"
    if not ecu_id:
        ecu_id = "7E0"
    if not tester_id:
        tester_id = "7E8"
    dll_path = str(dll_raw).strip() if dll_raw else None
    if state.diag:
        try:
            state.diag.shutdown()
        except Exception:
            pass
    state.diag = ComDiag(canif=state.canif, ecu_id=ecu_id, tester_id=tester_id, dll=dll_path)
    return jsonify({"ok": True, "ecu_id": ecu_id, "tester_id": tester_id, "dll": dll_path})


@app.route("/api/diag/send", methods=["POST"])
def api_diag_send():
    if not state.diag:
        return jsonify({"ok": False, "error": "Diagnostics not configured"}), 400
    payload = request.get_json(force=True, silent=True) or {}
    data = str(payload.get("data", "")).strip()
    timeout = int(payload.get("timeout", 500))
    try:
        recv = state.diag.send_and_received(data, ecu_id=state.diag.ecu_id, timeout=timeout)
        return jsonify({"ok": True, "response": recv})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@app.route("/api/diag/unlock", methods=["POST"])
def api_diag_unlock():
    if not state.diag:
        return jsonify({"ok": False, "error": "Diagnostics not configured"}), 400
    payload = request.get_json(force=True, silent=True) or {}
    dll_raw = payload.get("dll")
    if dll_raw:
        state.diag.set_dll(str(dll_raw).strip())
    if not state.diag.dll:
        return jsonify({"ok": False, "error": "Security DLL not configured"}), 400
    ecu_raw = payload.get("ecu_id")
    ecu_id = (str(ecu_raw).strip().upper() if ecu_raw is not None else state.diag.ecu_id) or state.diag.ecu_id
    try:
        unlocked = state.diag.unlock_security(ecu_id=ecu_id)
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    if unlocked:
        return jsonify({"ok": True, "ecu_id": ecu_id})
    return jsonify({"ok": False, "error": "Unlock failed"}), 400


@app.route("/api/diag/tester_present", methods=["POST"])
def api_diag_tester_present():
    if not state.diag:
        return jsonify({"ok": False, "error": "Diagnostics not configured"}), 400
    payload = request.get_json(force=True, silent=True) or {}
    action = payload.get("action", "start")
    interval = int(payload.get("interval", 2000))
    ecu_id = payload.get("ecu_id") or state.diag.ecu_id
    try:
        if action == "start":
            state.diag.start_tester_present(interval=interval, ecu_id=ecu_id)
        else:
            state.diag.stop_tester_present()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400


@socketio.on("connect")
def on_connect():
    emit("connected", {"ok": True, "decode": state.decode_enabled})


@socketio.on("start_trace")
def on_start_trace(_msg=None):
    if not state.canif:
        emit("trace_error", {"error": "CAN not initialized"})
        return
    if state.trace_running:
        emit("trace_info", {"info": "Trace already running"})
        return
    state.trace_running = True
    state.trace_thread = socketio.start_background_task(_trace_worker)
    emit("trace_info", {"info": "Trace started"})


@socketio.on("stop_trace")
def on_stop_trace(_msg=None):
    state.trace_running = False
    emit("trace_info", {"info": "Trace stopped"})


def main():
    host = os.environ.get("FLASK_HOST", "127.0.0.1")
    port = int(os.environ.get("FLASK_PORT", "5000"))
    debug = bool(os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes"))
    socketio.run(app, host=host, port=port, debug=debug)


if __name__ == "__main__":
    main()
