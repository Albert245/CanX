"""Session management primitives for the CAN Transport Protocol layer."""
from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Callable, List, Optional

from CANIF.CANInterface import CANInterface
from COMMON.Cast import Hex, HexArr2StrArr, Str2HexArr
from CANTP.Description import FCFS_CTS, FCFS_WAIT, FCFS_OVFLW
from CANTP.Frame import convertFF, expectedFrames, extractCF, increaseSN, nextCF

logger = logging.getLogger(__name__)


@dataclass
class FlowControlSettings:
    """Configuration for Flow Control frames."""

    block_size: int = 0
    st_min: int = 0x14
    flow_status: int = 0  # 0 == CTS

    def build_payload(self, pci: int = 0x3) -> str:
        """Return the 8 byte flow control payload string."""
        byte0 = Hex(((pci << 4) & 0xF0) | (self.flow_status & 0x0F))
        byte1 = Hex(self.block_size & 0xFF)
        byte2 = Hex(self.st_min & 0xFF)
        return f"{byte0} {byte1} {byte2} 00 00 00 00 00"


class FlowController:
    """Utility that transmits flow control frames."""

    def __init__(self, canif: CANInterface, ecu_id: str, padding: str) -> None:
        self._canif = canif
        self._ecu_id = ecu_id
        self._padding = padding

    def send(self, settings: FlowControlSettings) -> bool:
        payload = settings.build_payload()
        logger.debug("Sending FlowControl -> %s: %s", self._ecu_id, payload)
        return self._canif.write(self._ecu_id, payload, padding=self._padding)


class CANTPSession:
    """Represents one logical CAN-TP session between a tester and ECU."""

    def __init__(
        self,
        canif: CANInterface,
        ecu_id: str,
        tester_id: str,
        *,
        chunk_length: int,
        padding: str,
        rx_flow_control: FlowControlSettings,
        flow_control_timeout_ms: int = 1000,
    ) -> None:
        self._canif = canif
        self._ecu_id = ecu_id.upper()
        self._tester_id = tester_id.upper()
        self._chunk_length = chunk_length
        self._padding = padding
        self._rx_flow_control = rx_flow_control
        self._flow_control_timeout_ms = flow_control_timeout_ms
        self._rx_buffer: List[List[str]] = []
        self._buffer_cond = threading.Condition()
        self._closed = False
        self._rx_lock = threading.Lock()
        self._tx_lock = threading.Lock()
        self._flow_controller = FlowController(canif, self._ecu_id, padding)
        self._register_callback()

    # ------------------------------------------------------------------
    # Life-cycle helpers
    # ------------------------------------------------------------------
    def _register_callback(self) -> None:
        def _on_frame(message) -> None:
            payload = HexArr2StrArr(message.data)
            with self._buffer_cond:
                if self._closed:
                    return
                self._rx_buffer.append(payload)
                self._buffer_cond.notify_all()

        self._canif.subscribe_id_queue(self._tester_id, callback=_on_frame)

    def close(self) -> None:
        with self._buffer_cond:
            self._closed = True
            self._buffer_cond.notify_all()
        try:
            self._canif.unsubscribe_id_queue(self._tester_id)
        except Exception:
            logger.exception("Failed to unsubscribe CAN ID %s", self._tester_id)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def set_rx_flow_control(self, settings: FlowControlSettings) -> None:
        self._rx_flow_control = settings

    def receive(self, timeout_ms: int) -> List[str]:
        """Receive a single PDU (list of hex strings) from the ECU."""
        with self._rx_lock:
            first_frame = self._pop_matching(self._is_transport_payload, timeout_ms)
            if not first_frame:
                logger.debug("Timeout waiting for first frame on %s", self._tester_id)
                return []

            pci_type = self._pci_type(first_frame)
            if pci_type == 0x0:  # Single Frame
                payload_length = int(first_frame[0], 16) & 0x0F
                return first_frame[1 : 1 + payload_length]

            if pci_type != 0x1:
                logger.warning("Unexpected PCI type %s while waiting for FF", pci_type)
                return []

            expected_frames, total_length, data = expectedFrames(first_frame, self._chunk_length)
            logger.debug(
                "First frame received -> expected=%s total_length=%s current=%s",
                expected_frames,
                total_length,
                len(data),
            )
            if not self._flow_controller.send(self._rx_flow_control):
                logger.error("Failed to transmit Flow Control frame to %s", self._ecu_id)
                return []
            remaining_ms = timeout_ms
            start = time.monotonic()

            while len(data) < total_length:
                remaining_ms = self._remaining_ms(start, timeout_ms)
                if remaining_ms <= 0:
                    logger.warning("Timeout while waiting for CF frames from %s", self._tester_id)
                    return []

                cf = self._pop_matching(self._is_consecutive_frame, remaining_ms)
                if not cf:
                    logger.warning("Timeout retrieving consecutive frame from %s", self._tester_id)
                    return []
                data.extend(cf[1:])

            return data[:total_length]

    def send(self, data: str, padding: Optional[str] = None) -> bool:
        padding = padding if padding is not None else self._padding
        with self._tx_lock:
            raw_data = Str2HexArr(data)
            frame, remain_data = convertFF(raw_data, self._chunk_length)

            if not remain_data:  # Single Frame
                return self._canif.write(self._ecu_id, frame, padding=padding)

            if not self._canif.write(self._ecu_id, frame, padding=padding):
                return False

            fc_settings = self._wait_for_flow_control()
            if not fc_settings:
                logger.warning("Did not receive Flow Control frame from %s", self._tester_id)
                return False

            block_size = fc_settings.block_size
            st_min_seconds = self._interpret_st_min(fc_settings.st_min)
            frames_in_block = 0
            sequence_number = 0

            while remain_data:
                sequence_number = increaseSN(sequence_number)
                frame, remain_data = nextCF(sequence_number, remain_data, self._chunk_length)
                if not self._canif.write(self._ecu_id, frame, padding=padding):
                    return False

                frames_in_block += 1
                if st_min_seconds:
                    time.sleep(st_min_seconds)

                if block_size and frames_in_block >= block_size and remain_data:
                    fc_settings = self._wait_for_flow_control()
                    if not fc_settings:
                        logger.warning("Flow Control timeout in block for %s", self._tester_id)
                        return False
                    if fc_settings.flow_status != FCFS_CTS:
                        logger.warning("Unexpected Flow Status %s", fc_settings.flow_status)
                        return False
                    block_size = fc_settings.block_size
                    st_min_seconds = self._interpret_st_min(fc_settings.st_min)
                    frames_in_block = 0

            return True

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------
    def _wait_for_flow_control(self) -> Optional[FlowControlSettings]:
        deadline_ms = self._flow_control_timeout_ms
        start = time.monotonic()
        while True:
            remaining_ms = self._remaining_ms(start, deadline_ms)
            if remaining_ms <= 0:
                return None
            fc_payload = self._pop_matching(self._is_flow_control_frame, remaining_ms)
            if not fc_payload:
                return None
            fcfs, fcbs, fcstmin = extractCF(fc_payload)
            if fcfs == FCFS_WAIT:
                logger.debug("Received WAIT flow control -> waiting for next")
                continue
            if fcfs == FCFS_OVFLW:
                logger.error("Flow control overflow received from %s", self._tester_id)
                return None
            return FlowControlSettings(block_size=fcbs, st_min=fcstmin, flow_status=fcfs)

    def _pop_matching(self, predicate: Callable[[List[str]], bool], timeout_ms: int) -> Optional[List[str]]:
        deadline = time.monotonic() + (timeout_ms / 1000.0)
        with self._buffer_cond:
            while True:
                for index, payload in enumerate(self._rx_buffer):
                    if predicate(payload):
                        return self._rx_buffer.pop(index)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self._buffer_cond.wait(timeout=remaining)

    @staticmethod
    def _is_transport_payload(frame: List[str]) -> bool:
        if not frame:
            return False
        pci = int(frame[0], 16) >> 4
        return pci in (0x0, 0x1, 0x2)

    @staticmethod
    def _is_consecutive_frame(frame: List[str]) -> bool:
        if not frame:
            return False
        return (int(frame[0], 16) >> 4) == 0x2

    @staticmethod
    def _is_flow_control_frame(frame: List[str]) -> bool:
        if not frame:
            return False
        return (int(frame[0], 16) >> 4) == 0x3

    @staticmethod
    def _pci_type(frame: List[str]) -> int:
        return int(frame[0], 16) >> 4

    @staticmethod
    def _remaining_ms(start: float, timeout_ms: int) -> int:
        elapsed = (time.monotonic() - start) * 1000.0
        return int(timeout_ms - elapsed)

    @staticmethod
    def _interpret_st_min(value: int) -> float:
        if value <= 0x7F:
            return value / 1000.0
        if 0xF1 <= value <= 0xF9:
            return (value - 0xF0) / 10000.0
        return 0.0


class CANTPSessionManager:
    """Factory/registry that keeps track of CANTP sessions."""

    def __init__(
        self,
        canif: CANInterface,
        *,
        chunk_length: int,
        padding: str,
        default_rx_flow_control: FlowControlSettings,
        flow_control_timeout_ms: int = 1000,
    ) -> None:
        self._canif = canif
        self._chunk_length = chunk_length
        self._padding = padding
        self._default_rx_flow_control = default_rx_flow_control
        self._flow_control_timeout_ms = flow_control_timeout_ms
        self._sessions: dict[tuple[str, str], CANTPSession] = {}
        self._lock = threading.Lock()

    def get_session(self, ecu_id: str, tester_id: str) -> CANTPSession:
        key = (ecu_id.upper(), tester_id.upper())
        with self._lock:
            session = self._sessions.get(key)
            if session is None:
                session = CANTPSession(
                    self._canif,
                    ecu_id,
                    tester_id,
                    chunk_length=self._chunk_length,
                    padding=self._padding,
                    rx_flow_control=self._clone_flow_control(),
                    flow_control_timeout_ms=self._flow_control_timeout_ms,
                )
                self._sessions[key] = session
            return session

    def configure_rx_flow_control(
        self, ecu_id: str, tester_id: str, settings: FlowControlSettings
    ) -> None:
        session = self.get_session(ecu_id, tester_id)
        session.set_rx_flow_control(settings)

    def shutdown(self) -> None:
        with self._lock:
            for session in self._sessions.values():
                session.close()
            self._sessions.clear()

    def _clone_flow_control(self) -> FlowControlSettings:
        cfg = self._default_rx_flow_control
        return FlowControlSettings(
            block_size=cfg.block_size,
            st_min=cfg.st_min,
            flow_status=cfg.flow_status,
        )
