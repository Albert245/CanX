"""Example script showcasing the refactored CAN TP diagnostic stack."""

from __future__ import annotations

import atexit
import time
from typing import Optional

from CANIF.CANInterface import CANInterface
from CANTP.session import FlowControlSettings
from COMDIAG.ComDia import ComDiag

try:
    import ctypes

    time_begin_period = ctypes.windll.winmm.timeBeginPeriod
    time_end_period = ctypes.windll.winmm.timeEndPeriod
except (AttributeError, OSError):  # pragma: no cover - Windows specific
    time_begin_period = None
    time_end_period = None


def enable_high_res_timer() -> None:
    if time_begin_period is not None:
        time_begin_period(1)
        atexit.register(disable_high_res_timer)


def disable_high_res_timer() -> None:
    if time_end_period is not None:
        time_end_period(1)


def build_diag_interface(
    device: str,
    ecu_id: str,
    tester_id: str,
    *,
    channel: int = 0,
    is_fd: bool = False,
    rx_flow_control: Optional[FlowControlSettings] = None,
) -> tuple[CANInterface, ComDiag]:
    """Initialise CAN and diagnostics helpers with the new CAN-TP stack."""

    can_if = CANInterface(device=device, channel=channel, is_fd=is_fd)
    can_if.initialize_bus()
    diag = ComDiag(
        canif=can_if,
        ecu_id=ecu_id,
        tester_id=tester_id,
        rx_flow_control=rx_flow_control,
    )
    return can_if, diag


def main() -> None:
    enable_high_res_timer()

    ecu_id = "7B3"
    tester_addr = "7BB"
    dll_path = r"test.dll"

    flow_profile = FlowControlSettings(block_size=0, st_min=0x14)

    can_if, diag = build_diag_interface(
        device="PCAN",
        ecu_id=ecu_id,
        tester_id=tester_addr,
        rx_flow_control=flow_profile,
    )
    diag.set_dll(dll_path)

    start_time = time.time()

    # Example usage of periodic writes while diagnostics is active.
    periodic_ids = [
        "7B1",
        "7B2",
        "7B4",
        "7B5",
        "7B6",
        "7B7",
        "7B8",
        "7B9",
        "7BA",
        "7BC",
        "7BD",
        "7BE",
        "7BF",
    ]

    for arbitration_id in periodic_ids:
        can_if.write_periodic([arbitration_id, "02 10 03"], 200, 5000)

    while time.time() - start_time < 7:
        continue

    diag.shutdown()
    can_if.shutdown_bus()


if __name__ == "__main__":
    main()
