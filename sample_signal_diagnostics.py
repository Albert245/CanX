"""Utility script to troubleshoot missing DBC message signals in the UI.

This sample helper mirrors the backend checks the web UI performs when it
attempts to list the signals for a DBC message.  Running the script pinpoints
common failure modes (missing file, parse errors, unknown message names, empty
signal definitions, etc.) so that issues can be resolved before starting the
Flask app.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

try:  # Lazy import so the script still loads when cantools is absent.
    import cantools
    from cantools.database import errors as cantools_errors
except ModuleNotFoundError:  # pragma: no cover - environment dependent
    cantools = None
    cantools_errors = None

try:
    from E2E.DbcAdapter import DBCAdapter  # type: ignore
except ModuleNotFoundError as exc:  # pragma: no cover - environment dependent
    DBCAdapter = None  # type: ignore
    _DBC_IMPORT_ERROR = exc
else:
    _DBC_IMPORT_ERROR = None


def _format_message_list(messages: List[str], limit: int = 10) -> str:
    if not messages:
        return "<none>"
    if len(messages) <= limit:
        return ", ".join(messages)
    head = ", ".join(messages[:limit])
    return f"{head}, … (+{len(messages) - limit} more)"


def diagnose(dbc_path: Path, message_name: Optional[str] = None) -> Dict[str, object]:
    """Inspect a DBC file and return potential causes preventing signal listing."""

    findings: Dict[str, object] = {
        "dbc_path": str(dbc_path),
        "errors": [],
        "warnings": [],
        "message_summary": {},
    }

    if not dbc_path.exists():
        findings["errors"].append(f"DBC file '{dbc_path}' does not exist.")
        return findings

    if not dbc_path.is_file():
        findings["errors"].append(f"DBC path '{dbc_path}' is not a file.")
        return findings

    if cantools is None:
        findings["errors"].append(
            "The 'cantools' package is not installed. Install it to parse DBC files "
            "(pip install cantools)."
        )
        return findings

    if DBCAdapter is None:
        findings["errors"].append(
            "Failed to import DBCAdapter. Did you install the project dependencies?"
        )
        if _DBC_IMPORT_ERROR is not None:
            findings["errors"].append(str(_DBC_IMPORT_ERROR))
        return findings

    try:
        adapter = DBCAdapter(str(dbc_path))
    except FileNotFoundError:
        findings["errors"].append(f"DBC file '{dbc_path}' could not be found by DBCAdapter.")
        return findings
    except PermissionError:
        findings["errors"].append(f"Permission denied when accessing '{dbc_path}'.")
        return findings
    except Exception as exc:  # pragma: no cover - defensive guard
        parse_errors = []
        if cantools_errors is not None:
            for name in dir(cantools_errors):
                obj = getattr(cantools_errors, name)
                if isinstance(obj, type) and name.endswith("Error"):
                    parse_errors.append(obj)
        if any(isinstance(exc, err) for err in parse_errors):
            findings["errors"].append(f"Failed to parse DBC: {exc}")
        else:
            findings["errors"].append(f"Unexpected error while loading DBC: {exc}")
        return findings

    all_messages = sorted((msg.name for msg in adapter.db.messages))
    if not all_messages:
        findings["errors"].append("The DBC file does not define any messages.")
        return findings

    findings["message_summary"] = {
        "total_messages": len(all_messages),
        "example_messages": _format_message_list(all_messages),
    }

    if not message_name:
        findings["warnings"].append(
            "No message name provided. Pass --message to inspect a specific message."
        )
        return findings

    message = None
    try:
        message = adapter.db.get_message_by_name(message_name)
        findings["message_summary"]["resolved_by"] = "name"
    except KeyError:
        # Attempt to interpret the value as a frame id.
        try:
            numeric_id = int(str(message_name), 0)
        except (TypeError, ValueError):
            findings["errors"].append(
                f"Message '{message_name}' was not found by name and is not a valid frame id."
            )
            return findings
        try:
            message = adapter.db.get_message_by_frame_id(numeric_id)
            findings["message_summary"]["resolved_by"] = "frame_id"
            findings["message_summary"]["resolved_frame_id"] = numeric_id
        except KeyError:
            findings["errors"].append(
                f"No message found for frame id {hex(numeric_id)} ({numeric_id})."
            )
            return findings

    findings["message_summary"]["name"] = message.name
    findings["message_summary"]["frame_id"] = hex(message.frame_id)
    findings["message_summary"]["signal_count"] = len(message.signals)

    if not message.signals:
        findings["errors"].append(
            f"Message '{message.name}' does not declare any signals in the DBC file."
        )
        return findings

    missing_from_cache = []
    cache = adapter.current_signals.get(message.name, {})
    for signal in message.signals:
        if signal.name not in cache:
            missing_from_cache.append(signal.name)

    if missing_from_cache:
        findings["warnings"].append(
            "Signals missing from runtime cache: " + ", ".join(missing_from_cache)
        )

    findings["message_summary"]["example_signals"] = _format_message_list(
        [signal.name for signal in message.signals]
    )

    return findings


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Diagnose why the CanX UI cannot list DBC message signals."
    )
    parser.add_argument("dbc", type=Path, help="Path to the DBC file used by the UI.")
    parser.add_argument(
        "--message",
        "-m",
        help="Message name or frame id to inspect (e.g. EngineData or 0x123).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit the diagnostics report as JSON for downstream tooling.",
    )

    args = parser.parse_args(argv)

    findings = diagnose(args.dbc, args.message)

    if args.json:
        print(json.dumps(findings, indent=2, sort_keys=True))
    else:
        print(f"DBC path: {findings['dbc_path']}")
        if findings["message_summary"]:
            for key, value in findings["message_summary"].items():
                print(f"  {key}: {value}")
        if findings["errors"]:
            print("\nErrors:")
            for err in findings["errors"]:
                print(f"  - {err}")
        if findings["warnings"]:
            print("\nWarnings:")
            for warn in findings["warnings"]:
                print(f"  - {warn}")

    return 1 if findings["errors"] else 0


if __name__ == "__main__":  # pragma: no cover - CLI entry point
    sys.exit(main())

