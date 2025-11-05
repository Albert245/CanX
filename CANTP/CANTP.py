"""High level facade for the CAN Transport Protocol layer."""
from __future__ import annotations

import logging
from typing import Optional

from CANIF.CANInterface import CANInterface
from CANTP.session import CANTPSessionManager, FlowControlSettings

logger = logging.getLogger(__name__)


class CANTP:
    """Entry point for ISO-TP (CAN TP) send/receive operations."""

    def __init__(
        self,
        CanIF: CANInterface,
        padding: str = "00",
        *,
        default_rx_flow_control: Optional[FlowControlSettings] = None,
        flow_control_timeout_ms: int = 1000,
    ) -> None:
        if not isinstance(CanIF, CANInterface):
            raise TypeError(
                "Expected CanIF to be an instance of CANInterface, "
                f"but got {type(CanIF).__name__} instead."
            )

        self.CanIF = CanIF
        self.padding = padding
        self.is_fd = CanIF.is_fd
        self.chunk_length = 64 if self.is_fd else 8

        default_flow = default_rx_flow_control or FlowControlSettings()
        self._session_manager = CANTPSessionManager(
            CanIF,
            chunk_length=self.chunk_length,
            padding=self.padding,
            default_rx_flow_control=default_flow,
            flow_control_timeout_ms=flow_control_timeout_ms,
        )

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------
    def receive(self, ecu_id: str, tester_id: str, timeout: int = 300) -> list[str]:
        """Receive a PDU from ``ecu_id`` destined for ``tester_id``."""
        session = self._session_manager.get_session(ecu_id, tester_id)
        logger.debug("Receiving PDU from %s -> %s", ecu_id, tester_id)
        return session.receive(timeout)

    def send(
        self,
        ecu_id: str,
        tester_id: str,
        data: str,
        padding: Optional[str] = None,
    ) -> bool:
        """Transmit a PDU to ``ecu_id`` and await flow-control from ``tester_id``."""
        session = self._session_manager.get_session(ecu_id, tester_id)
        logger.debug("Sending PDU to %s from %s", ecu_id, tester_id)
        return session.send(data, padding)

    def configure_rx_flow_control(
        self, ecu_id: str, tester_id: str, settings: FlowControlSettings
    ) -> None:
        """Override the default RX flow-control profile for a session."""
        self._session_manager.configure_rx_flow_control(ecu_id, tester_id, settings)

    def shutdown(self) -> None:
        """Cleanup resources and stop tracking sessions."""
        self._session_manager.shutdown()

