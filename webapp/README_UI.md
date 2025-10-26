# CanX Web UI (Flask + Socket.IO)

Minimal, fast web interface for CAN operations: live trace, DBC message control, and diagnostics (UDS) built on top of the existing CanX stack.

## Features
- Trace: Live table with ID filter and optional DBC decode
- Messages: Browse DBC messages, edit signals, start/stop periodic, push on-event updates
- Diagnostics: Configure ECU/Tester IDs, send raw UDS hex, start/stop Tester Present

## Install
Make sure your Python environment has the required packages:

- Core: `python-can`, `cantools`
- Web: `flask`, `flask-socketio`, `python-socketio`
- Optional (better throughput): `eventlet`

Example:
```
pip install python-can cantools flask flask-socketio python-socketio eventlet
```

## Run
```
python webapp/app.py
```
Then open `http://127.0.0.1:5000` in your browser.

## Usage
1) Initialize CAN at the top (device, channel, CAN FD, padding, DBC path)
2) Trace tab: Start/Stop trace; filter by ID; toggle decode
3) Messages tab:
   - Load DBC messages
   - Select a message to view current signals
   - Start/Stop periodic (ms); optional duration (ms)
   - Edit signals and click Update Signals (on-event bursts handled automatically)
4) Diagnostics tab:
   - Configure ECU/Tester IDs
   - Send raw UDS request (hex string) and view response
   - Start/Stop Tester Present loop with a chosen interval

## Notes
- DBC decode in the Trace view requires you to initialize with a valid DBC path.
- Periodic stop is performed via the underlying scheduler by message ID to work around current stop API limitations.
- The UI uses the reader thread’s default queue; trace rate depends on your hardware and Python runtime.
