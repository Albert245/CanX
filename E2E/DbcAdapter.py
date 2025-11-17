import threading
import collections
from copy import deepcopy
from typing import Dict, Any, Optional, Deque, Union
import cantools
from E2E.crc import*
from COMMON.Cast import*
from logger.log import*
 
class DBCAdapter:
    def __init__(self, dbc_path: str):
        self.db = cantools.database.load_file(dbc_path)
        self.lock = threading.Lock()
        self.messages_atrributes: Dict[str,Dict[str, Any]] = {}
        self.signal_queues: Dict[str, Deque[Dict[str, Any]]] = {}
        self.nodes: Dict[str,Dict[str]] = {}
        self.receivers: Dict[str,Dict[str]] = {}
        self.current_signals: Dict[str,Dict[str, Any]] = {}
        self.initial: Dict[str,Dict[str,Any]] = {}
        self.message_trim: Dict[str, Dict[str,Any]] = {}
        self.message_cache = {}
 
 
        for msg in self.db.messages:
            self.current_signals[msg.name] = {}
            self.initial[msg.name] = {}
            self.message_trim[msg.name] = {}
            self.message_cache[msg.frame_id] = msg
            for sig in msg.signals:
                sig_initial = 0
                try:
                    sig_initial = int(sig.raw_initial)
                except:
                    pass
                initial_value = trim((sig_initial*sig.scale + sig.offset), sig.minimum, sig.maximum)
                self.current_signals[msg.name][sig.name] = initial_value
                self.initial[msg.name][sig.name] = initial_value
                self.message_trim[msg.name][sig.name] = {"minimum": sig.minimum, "maximum": sig.maximum}
 
            
            for sender in msg.senders:
                if sender not in self.nodes:
                    self.nodes[sender] = [msg.name]
                else:
                    self.nodes[sender].append(msg.name)
            for receiver in msg.receivers:
                if receiver not in self.receivers:
                    self.receivers[receiver] = [msg.name]
                else:
                    self.receivers[receiver].append(msg.name)
            grp = False
            alvcnt = ""
            alv_len = 0
            crc = ""
            for sig in msg.signals:
                if "AlvCnt" in sig.name:
                    grp = True
                    alvcnt = sig.name
                    alv_len = (1<<sig.length)-1
                elif "Crc" in sig.name:
                    crc = sig.name
            cmt = msg.comment if msg.comment else ""
            self.messages_atrributes[msg.name] = {
                "Periodic": True if msg.send_type == "Cyclic" else False,
                "On_event" : True if "Event" in cmt else False,
                "Group": grp,
                "AlvCnt": alvcnt,
                "CRC": crc
            }
            self.signal_queues[msg.name] = collections.deque(maxlen=1)
 
    def push_signals(self, message_name: str, signals: Dict[str,Any]):
        with self.lock:
            if message_name not in self.signal_queues:
                raise KeyError(f"Message {message_name} not found in DBC")

            trimmed_signals: Dict[str, Any] = {}
            for signal, value in signals.items():
                try:
                    trimmed_signals[signal] = trim(
                        value,
                        self.message_trim[message_name][signal]["minimum"],
                        self.message_trim[message_name][signal]["maximum"],
                    )
                except Exception as e:
                    logger.error(f"[ERROR] Failed to push signal {signal}: {e}")
            self.current_signals[message_name].update(trimmed_signals)
            self.signal_queues[message_name].append(trimmed_signals)

    def get_payload(self, msg_id: Union[int, str]) -> bytes:
        if isinstance(msg_id, str):
            msg = self.db.get_message_by_name(msg_id)
        else:
            msg = self.message_cache[msg_id]
        message_name = msg.name
        attrs = self.messages_atrributes[message_name]
        alvcnt_name = attrs["AlvCnt"] if attrs["Group"] else None
        alvcnt_update = attrs["Group"] and not attrs["On_event"]

        with self.lock:
            if self.signal_queues[message_name]:
                updates = self.signal_queues[message_name].popleft()
                self.current_signals[message_name].update(updates)
                if attrs["Group"]:
                    alvcnt_update = True

            if alvcnt_update and alvcnt_name:
                alvcnt = ((self.current_signals[message_name][alvcnt_name] + 1) & 0xff)
                self.current_signals[message_name][alvcnt_name] = alvcnt

            signals_snapshot = self.current_signals[message_name].copy()

        payload = msg.encode(signals_snapshot)

        crc_name = attrs["CRC"]
        if crc_name:
            data_bytes = bytearray(payload)
            crc_calc = crc_calculate_cy(msg.frame_id, data_bytes)
            signals_snapshot[crc_name] = crc_calc
            with self.lock:
                self.current_signals[message_name][crc_name] = crc_calc
            payload = msg.encode(signals_snapshot)

        return payload
    def reset_message(self, message_name: Optional[str] = None):
        with self.lock:
            try:
                if message_name:
                    self.current_signals[message_name] = deepcopy(self.initial[message_name])
                    self.signal_queues[message_name].clear()
                else:
                    self.current_signals = {msg: deepcopy(signals) for msg, signals in self.initial.items()}
                    for msg in self.signal_queues.keys():
                        self.signal_queues[msg].clear()
            except Exception as e:
                logger.error(f"[RESET] Failed to reset message {message_name}: {e}")
    def decode_message(self, message_id: int, data: bytes) -> Dict[str, Any]:
        try:
            msg = self.db.get_message_by_frame_id(message_id)
            signals = msg.decode(data)
            return signals
        except Exception as e:
            logger.debug(f"[DECODE] Failed to decode messageID {hex(message_id)}: {e}")
            return{}
    def Messages(self):
        return self.current_signals.keys()
    def Message_dict(self, msg_name):
        return self.current_signals[msg_name]
 
    def Nodes(self):
        return self.nodes
    def Receivers(self):
        """List of messages by receivers"""
        return self.receivers
    def Messages_Obj(self):
        return self.db.messages
    def Message_attributes(self, frame_id_or_name : Union[int,str]):
        if isinstance(frame_id_or_name, int):
            message = self.db.get_message_by_frame_id(frame_id_or_name)
        elif isinstance(frame_id_or_name, str):
            message = self.db.get_message_by_name(frame_id_or_name)
        else:
            raise ValueError(f"Invalid frame_id_or_name '{frame_id_or_name}'")
        return message
 
    def get_message_id_by_name(self, msg_name):
        message = self.db.get_message_by_name(msg_name)
        return message.frame_id
    def isOnEvent(self, frame_id_or_name):
        if isinstance(frame_id_or_name, int):
            message = self.db.get_message_by_frame_id(frame_id_or_name)
            frame_id_or_name = message.name
        elif isinstance(frame_id_or_name, str):
            pass
        return self.messages_atrributes[frame_id_or_name]["On_event"]