"""
Extended DBC diagnostic sample for CanX.

- Fixed DBC path (hardcoded).
- Iterates through all messages in the DBC.
- Adds additional test cases simulating JSON serialization and DBC parse failures.
- Produces both human-readable and JSON reports for regression comparison.

Usage:
    python diag_dbc_fulltest.py
"""

from __future__ import annotations

import json
import sys
import traceback
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

try:
    import cantools
    from cantools.database import errors as cantools_errors
except ModuleNotFoundError:
    cantools = None
    cantools_errors = None

try:
    from E2E.DbcAdapter import DBCAdapter  # type: ignore
except ModuleNotFoundError as exc:
    DBCAdapter = None
    _DBC_IMPORT_ERROR = exc
else:
    _DBC_IMPORT_ERROR = None


# ✅ FIXED path to your DBC file (adjust here)
DBC_PATH = Path(r"g:\Side_Project\CanX\data\example.dbc")  # <-- chỉnh theo đường dẫn của bạn
OUTPUT_JSON = Path("dbc_diagnostic_report.json")


def safe_json_serialize(obj: Any) -> str:
    """Try to serialize object safely, catching json.JSONDecodeError, TypeError, etc."""
    try:
        return json.dumps(obj, ensure_ascii=False)
    except Exception as e:
        return f"<JSON_ERROR: {e}>"


def _format_list(items: List[str], limit: int = 8) -> str:
    if not items:
        return "<none>"
    if len(items) <= limit:
        return ", ".join(items)
    return ", ".join(items[:limit]) + f", …(+{len(items)-limit})"


def diagnose_all(dbc_path: Path) -> Dict[str, Any]:
    findings: Dict[str, Any] = {
        "dbc_path": str(dbc_path),
        "timestamp": datetime.now().isoformat(),
        "summary": {},
        "messages": {},
        "global_errors": [],
    }

    if not dbc_path.exists():
        findings["global_errors"].append(f"DBC '{dbc_path}' not found.")
        return findings
    if not dbc_path.is_file():
        findings["global_errors"].append(f"'{dbc_path}' is not a valid file.")
        return findings

    if cantools is None or DBCAdapter is None:
        findings["global_errors"].append("Missing required dependencies: cantools or DBCAdapter.")
        return findings

    try:
        adapter = DBCAdapter(str(dbc_path))
        db = adapter.db
    except Exception as e:
        findings["global_errors"].append(f"DBC load failed: {e}")
        tb = traceback.format_exc(limit=2)
        findings["global_errors"].append(tb)
        return findings

    messages = sorted(db.messages, key=lambda m: m.name)
    findings["summary"]["total_messages"] = len(messages)
    findings["summary"]["example_messages"] = _format_list([m.name for m in messages])

    if not messages:
        findings["global_errors"].append("No messages defined in this DBC.")
        return findings

    for msg in messages:
        mdata: Dict[str, Any] = {
            "frame_id": hex(msg.frame_id),
            "signal_count": len(msg.signals),
            "errors": [],
            "warnings": [],
        }
        try:
            # 🔸 Check signal definitions
            if not msg.signals:
                mdata["errors"].append("Message defines no signals.")
                findings["messages"][msg.name] = mdata
                continue

            # 🔸 Validate cache consistency
            cache = adapter.current_signals.get(msg.name, {})
            missing = [s.name for s in msg.signals if s.name not in cache]
            if missing:
                mdata["warnings"].append(f"Missing from cache: {_format_list(missing)}")

            # 🔸 Test JSON serialization safety
            test_payload = {
                "frame_id": msg.frame_id,
                "signals": [s.name for s in msg.signals],
                "fake_obj": lambda x: x,  # purposely unserializable
            }
            js = safe_json_serialize(test_payload)
            if js.startswith("<JSON_ERROR"):
                mdata["warnings"].append(f"JSON serialization failed (expected test): {js}")

            # 🔸 Detect duplicate signal names
            sig_names = [s.name for s in msg.signals]
            if len(sig_names) != len(set(sig_names)):
                mdata["warnings"].append("Duplicate signal names detected.")

            # 🔸 Detect strange types
            for sig in msg.signals:
                if not hasattr(sig, "start") or not hasattr(sig, "length"):
                    mdata["errors"].append(f"Signal '{sig.name}' missing start/length attributes.")
                    break

            mdata["example_signals"] = _format_list(sig_names)

        except Exception as e:
            mdata["errors"].append(f"Unhandled exception: {e}")
            mdata["errors"].append(traceback.format_exc(limit=1))

        findings["messages"][msg.name] = mdata

    return findings


def print_summary(findings: Dict[str, Any]) -> None:
    print(f"DBC path: {findings['dbc_path']}")
    print(f"Total messages: {findings['summary'].get('total_messages', 0)}")
    if findings["global_errors"]:
        print("\nGlobal Errors:")
        for e in findings["global_errors"]:
            print(" -", e)
    for name, info in findings["messages"].items():
        errs = len(info["errors"])
        warns = len(info["warnings"])
        print(f"\n[{name}] ({len(info['errors'])} errors, {len(info['warnings'])} warnings)")
        if errs:
            for e in info["errors"]:
                print("  ❌", e)
        if warns:
            for w in info["warnings"]:
                print("  ⚠️ ", w)


def main() -> int:
    print("=== CanX DBC Diagnostic Runner ===")
    findings = diagnose_all(DBC_PATH)
    print_summary(findings)

    # Write to file for review
    try:
        with OUTPUT_JSON.open("w", encoding="utf-8") as f:
            json.dump(findings, f, indent=2, ensure_ascii=False)
        print(f"\nReport written to: {OUTPUT_JSON.resolve()}")
    except Exception as e:
        print(f"⚠️ Could not write report: {e}")

    return 1 if findings.get("global_errors") else 0


if __name__ == "__main__":
    sys.exit(main())
