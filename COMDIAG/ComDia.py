"""Diagnostics helper built on top of the refactored CAN TP module."""

from __future__ import annotations

import threading
import time
from typing import Optional

from CANTP.CANTP import CANTP
from CANTP.Frame import NRC_check
from CANTP.session import FlowControlSettings
from CANIF.CANInterface import CANInterface
from COMMON.Cast import Hex, StrArr2Int
from proxy_dll.Generate_key_from_dll import ASK_KeyGenerate


class ComDiag:
    """High level diagnostic utilities backed by :class:`CANTP`."""

    def __init__(
        self,
        canif: CANInterface,
        ecu_id: str,
        tester_id: str,
        dll: Optional[str] = None,
        rx_flow_control: Optional[FlowControlSettings] = None,
    ) -> None:
        """Create a diagnostic helper bound to a CAN interface and CAN-TP session."""

        if not isinstance(canif, CANInterface):
            raise TypeError(
                "Expected canif to be an instance of CANInterface, "
                f"but got {type(canif).__name__}."
            )

        self.canif = canif
        self.cantp = CANTP(
            CanIF=canif,
            padding=canif.padding,
            default_rx_flow_control=rx_flow_control,
        )
        self.tester_id = tester_id.upper()
        self.ecu_id = ecu_id.upper()
        self.keep_alive = False
        self.thread: Optional[threading.Thread] = None
        self.dll = dll

    # ------------------------------------------------------------------
    # Configuration helpers
    # ------------------------------------------------------------------
    def set_dll(self, dll_path: str) -> None:
        self.dll = dll_path

    def configure_rx_flow_control(self, settings: FlowControlSettings) -> None:
        """Override RX flow-control profile for this tester/ECU pair."""

        self.cantp.configure_rx_flow_control(self.ecu_id, self.tester_id, settings)

    # ------------------------------------------------------------------
    # Core diagnostic operations
    # ------------------------------------------------------------------
    def send(self, msg: str, lenght: int = 8, ecu_id: Optional[str] = None) -> bool:
        del lenght  # kept for backwards compatibility with previous signature
        if not ecu_id:
            ecu_id = self.ecu_id
        return self.cantp.send(ecu_id.upper(), self.tester_id, msg)

    def receive(self, timeout: int = 300) -> list[str]:
        """Receive a diagnostic response payload (without PCI metadata)."""

        recv = self.cantp.receive(self.ecu_id, self.tester_id, timeout)
        if recv and NRC_check(recv) and len(recv) > 2:
            if int(recv[2], 16) == 0x78:
                return self.receive(timeout=timeout)
        return recv

    def send_and_received(
        self,
        raw_msg: str,
        ecu_id: str = "7B3",
        lenght: int = 8,
        timeout: int = 300,
    ) -> Optional[list[str]]:
        """Send a diagnostic request and wait for the matching response."""

        raw_msg = raw_msg.strip()
        msg = raw_msg.replace(" ", "")
        SID = msg[:2]
        send = self.send(raw_msg, lenght=lenght, ecu_id=ecu_id)
        start_time = time.time()

        if not send:
            return None
        recv = self.receive(timeout=timeout)
        while (not recv) and (time.time() - start_time < (timeout / 1000)):
            recv = self.receive(timeout=timeout)

        if not recv:
            return None
        pos_sid = Hex(int(recv[0], 16) - 0x40)
        if recv[0] == SID or pos_sid == SID:
            return recv
        if len(recv) > 1:
            pos_sid = Hex(int(recv[1], 16) - 0x40)
            if recv[1] == SID or pos_sid == SID:
                return recv
        return None

    def send_tester_present(self, ecu_id: Optional[str]) -> bool:
        """Send a Tester Present (0x3E 80) message to keep the session alive."""

        if not ecu_id:
            ecu_id = self.ecu_id
        tester_present_msg = "3E 80"
        return self.send(tester_present_msg, ecu_id=ecu_id)

    def _tester_present_loop(self, interval: int, ecu_id: str) -> None:
        """Internal method to send Tester Present messages in a loop."""

        interval_sec = interval / 1000
        while self.keep_alive:
            success = self.send_tester_present(ecu_id)
            if not success:
                print("Warning: Tester Present message failed!")
            time.sleep(interval_sec)
        print("Stopped Tester Present")

    def start_tester_present(self, interval: int = 2000, ecu_id: Optional[str] = None) -> None:
        """Start sending Tester Present messages periodically in a background thread."""

        if not ecu_id:
            ecu_id = self.ecu_id
        if self.thread and self.thread.is_alive():
            print("Tester Present loop is already running!")
            return

        self.keep_alive = True
        self.thread = threading.Thread(
            target=self._tester_present_loop,
            args=(interval, ecu_id),
            daemon=True,
        )
        self.thread.start()

    def stop_tester_present(self) -> None:
        """Stop the Tester Present background loop."""

        if not self.keep_alive:
            print("Tester Present loop is not running.")
            return

        print("Stopping Tester Present loop...")
        self.keep_alive = False
        if self.thread:
            self.thread.join()

    def get_key(self, req: list[str]) -> Optional[str]:
        if not self.dll:
            return None
        seed = StrArr2Int(req[2:])
        key = ASK_KeyGenerate(dll_path=self.dll, seed=seed)
        try:
            int(key, 16)
            return key
        except ValueError:
            print(f"ERROR: key return: {key}")
            return None

    def unlock_security(self, ecu_id: str = "7B3") -> bool:
        """Unlock security by diagnostic service $27."""

        recv = self.send_and_received("27 11", ecu_id=ecu_id)
        if not recv:
            print("Timeout - Seca")
            return False
        if NRC_check(recv):
            print(f"NRC: {recv}")
            return False
        key = self.get_key(recv)
        if not key:
            print("ERROR: generate key failed")
            return False
        recv = self.send_and_received("27 12" + key, ecu_id=ecu_id)
        if NRC_check(recv):
            print("ERROR: wrong key")
            print(f"NRC: {recv}")
            return False
        print("INFO: Seca Unlocked")
        return True

    def send_periodic(
        self, ecu_id: str, raw_data: str, period: int, duration: Optional[int] = None
    ) -> bool:
        msg = [ecu_id, raw_data]
        return self.canif.write_periodic(message=msg, period=period, duration=duration)

    def stop_periodic(self, ecu_id: str) -> bool:  # noqa: ARG002
        return self.canif.stop_all_periodic()

    def shutdown(self) -> None:
        """Tear down CAN-TP resources tracked by this diagnostic helper."""

        self.stop_tester_present()
        self.cantp.shutdown()
