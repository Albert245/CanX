import json
import queue
import threading
import time
from pathlib import Path
from typing import Iterable, Tuple

from COMMON.Cast import Hex, HexArr2Str
from logger.log import logger


class FileWriterThread(threading.Thread):
    def __init__(self, trace_queue: queue.Queue, file_path: str, *, batch_size: int = 80):
        super().__init__(daemon=True)
        self.trace_queue = trace_queue
        self.file_path = Path(file_path)
        self.batch_size = max(1, batch_size)
        self.running = threading.Event()

    def _serialize(self, message_tuple: Tuple[object, str]) -> str:
        msg, direction = message_tuple
        direction = str(direction or "rx").lower()
        try:
            timestamp = float(getattr(msg, "timestamp", time.time()))
        except Exception:
            timestamp = time.time()
        try:
            arb_id = Hex(getattr(msg, "arbitration_id", 0))
        except Exception:
            arb_id = ""
        try:
            data_str = HexArr2Str(getattr(msg, "data", b""))
        except Exception:
            data_str = ""
        is_fd = bool(getattr(msg, "is_fd", False))
        is_extended = bool(getattr(msg, "is_extended_id", False))
        payload = {
            "ts": timestamp,
            "id": arb_id,
            "direction": "tx" if direction == "tx" else "rx",
            "data": data_str,
            "is_fd": is_fd,
            "is_extended": is_extended,
        }
        return json.dumps(payload)

    def _flush(self, fh, batch: Iterable[Tuple[object, str]]):
        try:
            for entry in batch:
                fh.write(self._serialize(entry))
                fh.write("\n")
            fh.flush()
        except Exception:
            logger.exception("Failed to flush CAN log batch")

    def stop(self):
        self.running.clear()

    def run(self):
        self.running.set()
        try:
            self.file_path.parent.mkdir(parents=True, exist_ok=True)
        except Exception:
            logger.exception("Unable to create log directory %s", self.file_path.parent)
        buffer: list[Tuple[object, str]] = []
        with self.file_path.open("a", encoding="utf-8") as fh:
            while self.running.is_set() or buffer or not self.trace_queue.empty():
                try:
                    item = self.trace_queue.get(timeout=0.25)
                    buffer.append(item)
                    if len(buffer) >= self.batch_size:
                        self._flush(fh, buffer)
                        buffer.clear()
                except queue.Empty:
                    if buffer:
                        self._flush(fh, buffer)
                        buffer.clear()
            if buffer:
                self._flush(fh, buffer)
