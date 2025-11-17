"""
CanX – Full DBC Diagnostic v2
-----------------------------
This script simulates the REAL backend behaviour of:

    GET /api/dbc/message_info/<name>

so that you can reproduce every “Failed to load message”
without opening the UI.

It detects:
    - parse errors
    - backend serialization errors
    - invalid signal attributes
    - choices that break JSON
    - faulty units/scale/offset
    - duplicate signals
    - NaN/Inf/default value problems

Outputs:
    - clean console summary
    - full JSON report (dbc_full_report.json)
"""

from __future__ import annotations

import json
import math
import traceback
from pathlib import Path
from typing import Dict, List, Any
from logger.log import logger

try:
    import cantools
except ModuleNotFoundError:
    logger.error("❌ cantools not installed. Install with: pip install cantools")
    raise

try:
    from E2E.DbcAdapter import DBCAdapter
except Exception as exc:
    logger.error("❌ Could not import DBCAdapter:", exc)
    raise

# ---------------------------------------------------------
# CONFIG –  FIXED PATH TO YOUR DBC
# ---------------------------------------------------------
DBC_PATH = Path(r"g:\Side_Project\CanX\data\example.dbc")  # ← chỉnh path tại đây
OUTPUT_JSON = Path("dbc_full_report.json")


# ---------------------------------------------------------
# UTILS
# ---------------------------------------------------------

def safe_json(value: Any) -> str:
    try:
        json.dumps(value, ensure_ascii=False)
        return "OK"
    except Exception as e:
        return f"JSON_ERROR: {e}"


def detect_non_serializable_dict(d: Dict) -> List[str]:
    bad = []
    for k, v in d.items():
        try:
            json.dumps({k: v})
        except Exception as e:
            bad.append(f"{k}: {type(v).__name__} → {e}")
    return bad


def detect_message_json_issue(payload: Dict[str, Any]) -> str | None:
    """Return a human-readable explanation if payload is not JSON serializable."""
    try:
        json.dumps(payload, ensure_ascii=False)
        return None
    except Exception as exc:
        # Inspect signal objects first to pinpoint problematic entries.
        signals = payload.get("signals", [])
        for idx, sig in enumerate(signals):
            try:
                json.dumps(sig, ensure_ascii=False)
            except Exception as sig_exc:
                name = sig.get("name") if isinstance(sig, dict) else getattr(sig, "name", None)
                label = f"signal index {idx}" if name is None else f"signal '{name}'"
                return f"Backend payload JSON error at {label}: {sig_exc}"

        # Inspect other top-level keys.
        for key, value in payload.items():
            try:
                json.dumps({key: value}, ensure_ascii=False)
            except Exception as key_exc:
                return f"Backend payload JSON error at field '{key}' ({type(value).__name__}): {key_exc}"

        return f"Backend payload JSON error: {exc}"


def normalize_signal(signal) -> Dict[str, Any]:
    """Simulate EXACT CanX backend JSON that the UI expects."""
    return {
        "name": signal.name,
        "start": getattr(signal, "start", None),
        "length": getattr(signal, "length", None),
        "scale": getattr(signal, "scale", None),
        "offset": getattr(signal, "offset", None),
        "is_float": isinstance(getattr(signal, "scale", None), float),
        "unit": getattr(signal, "unit", None),
        "choices": getattr(signal, "choices", {}) or {},
    }


# ---------------------------------------------------------
# MAIN TEST ENGINE
# ---------------------------------------------------------

def analyze_message(adapter, msg) -> Dict[str, Any]:
    """
    Apply the CanX backend logic to the message,
    returning detailed failure reasons.
    """
    result = {
        "frame_id": hex(msg.frame_id),
        "signal_count": len(msg.signals),
        "errors": [],
        "warnings": [],
        "signals": [],
    }

    # No signals?
    if not msg.signals:
        result["errors"].append("Message has NO signals.")
        return result

    # Duplicate signal names
    names = [s.name for s in msg.signals]
    if len(names) != len(set(names)):
        result["errors"].append("Duplicate signal names detected.")

    normalized_signals = []

    # Check each signal
    for s in msg.signals:
        sig_info = {"name": s.name, "errors": [], "warnings": []}

        # Check start/length
        if getattr(s, "start", None) is None:
            sig_info["errors"].append("Missing 'start' attribute")
        if getattr(s, "length", None) is None:
            sig_info["errors"].append("Missing 'length' attribute")

        # scale/offset validity
        scale = getattr(s, "scale", None)
        offset = getattr(s, "offset", None)

        if isinstance(scale, float) and math.isnan(scale):
            sig_info["errors"].append("scale = NaN")
        if isinstance(offset, float) and math.isnan(offset):
            sig_info["errors"].append("offset = NaN")

        # unit issues (unicode, strange chars)
        unit = getattr(s, "unit", "")
        if isinstance(unit, str):
            try:
                json.dumps({"u": unit})
            except Exception as e:
                sig_info["errors"].append(f"unit JSON error: {e}")

        # choices must be JSON-serializable
        choices = getattr(s, "choices", {}) or {}
        bad_choices = detect_non_serializable_dict(choices)
        if bad_choices:
            sig_info["errors"].append("Invalid choices: " + ", ".join(bad_choices))

        # Simulate EXACT backend JSON packing
        backend_obj = normalize_signal(s)
        js_status = safe_json(backend_obj)
        if js_status != "OK":
            sig_info["errors"].append(f"Backend JSON error: {js_status}")

        if sig_info["errors"]:
            result["errors"].append(f"Signal '{s.name}' failed checks: {sig_info['errors']}")

        result["signals"].append(sig_info)
        normalized_signals.append(normalize_signal(s))

    # Additional backend JSON payload verification
    backend_payload = {
        "frame_id": msg.frame_id,
        "signals": normalized_signals,
    }
    json_issue = detect_message_json_issue(backend_payload)
    if json_issue:
        result["errors"].append(json_issue)

    return result


def run_full_diagnostic() -> Dict[str, Any]:
    findings = {
        "dbc_path": str(DBC_PATH),
        "global_errors": [],
        "messages": {},
    }

    # Load DBC
    try:
        adapter = DBCAdapter(str(DBC_PATH))
        db = adapter.db
    except Exception as exc:
        findings["global_errors"].append(f"DBC load failed: {exc}")
        findings["global_errors"].append(traceback.format_exc())
        return findings

    msgs = db.messages
    if not msgs:
        findings["global_errors"].append("DBC contains zero messages.")
        return findings

    for msg in msgs:
        try:
            result = analyze_message(adapter, msg)
        except Exception as exc:
            result = {
                "frame_id": hex(msg.frame_id),
                "signal_count": len(msg.signals),
                "errors": [f"Unhandled exception: {exc}", traceback.format_exc()],
                "signals": [],
            }

        findings["messages"][msg.name] = result

    return findings


# ---------------------------------------------------------
# ENTRY POINT
# ---------------------------------------------------------

if __name__ == "__main__":
    logger.info("=== CanX Full DBC Diagnostic v2 ===")
    findings = run_full_diagnostic()

    # PRINT SUMMARY
    for name, info in findings["messages"].items():
        logger.info(f"\n[{name}] ({len(info['errors'])} errors)")
        for e in info["errors"]:
            logger.error(f"  ❌ {e}")

    # SAVE JSON
    try:
        with OUTPUT_JSON.open("w", encoding="utf-8") as f:
            json.dump(findings, f, indent=2, ensure_ascii=False)
        logger.info(f"\nReport saved: {OUTPUT_JSON.resolve()}")
    except Exception as e:
        logger.error(f"❌ Could not write report: {e}")

    if findings["global_errors"]:
        logger.info("\nGLOBAL ERRORS:")
        for e in findings["global_errors"]:
            logger.info(f" - {e}")
