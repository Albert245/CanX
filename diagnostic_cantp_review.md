# Diagnostic / CAN-TP Flow Review

## Overview
This document summarizes the current diagnostic stack and its CAN-TP data-path, along with observations about why multi-frame receptions may fail after sending Flow Control (FC).

## Architecture Snapshot
- `COMDIAG/ComDia.py` builds diagnostic helpers on top of the CAN-TP facade, sending requests and collecting responses through shared ECU/tester IDs. It delegates RX flow-control configuration to CAN-TP and reissues Tester Present messages in a background loop when requested.
- `CANTP/CANTP.py` is a thin entry point that routes `send`/`receive` calls into per-pair `CANTPSession` instances while handling ISO-TP padding and CAN FD chunk sizing.
- `CANTP/session.py` hosts the session logic: subscribing to CAN IDs, buffering incoming frames via callbacks, and orchestrating ISO-TP segmentation/reassembly with flow-control and timeout handling.
- `CANIF` implements bus access and message queuing; `CANIF/RWThread/CANReaderThread.py` receives frames and drives per-ID callbacks registered by CAN-TP.

## Receive Path (multi-frame)
1. `ComDiag.receive()` calls `CANTP.receive()` for the bound ECU/tester pair and retries on NRC 0x78 (Response Pending).【F:COMDIAG/ComDia.py†L48-L74】
2. `CANTP.receive()` fetches the session from `CANTPSessionManager` and delegates to `CANTPSession.receive()` with the configured timeout.【F:CANTP/CANTP.py†L29-L48】
3. `CANTPSession.receive()`
   - Waits for the first transport payload (SF/FF/CF) from the subscribed tester queue and short-circuits on timeout.【F:CANTP/session.py†L66-L77】
   - If the PCI type is Single Frame, it slices out the payload and returns it.【F:CANTP/session.py†L78-L81】
   - For a First Frame, it computes the expected payload length, sends an FC frame using the session’s `FlowController`, and enters a loop collecting Consecutive Frames until the total length is satisfied or a timeout occurs.【F:CANTP/session.py†L83-L116】
   - CF payload bytes are appended in arrival order without sequence-number validation before the final payload is returned.【F:CANTP/session.py†L106-L115】
4. The RX callback registered at session creation appends every frame received for the tester ID into an in-memory buffer and notifies blocked receivers.【F:CANTP/session.py†L50-L71】

## Observations & Potential Root Causes
- **Stray CF treated as a new session start**: `_pop_matching` initially accepts any transport payload (SF/FF/CF). If a leftover CF from a previous transaction remains in the buffer, a fresh `receive()` may grab it, classify the PCI as unexpected, and abort early, producing the observed “No Response” despite subsequent CFs arriving.【F:CANTP/session.py†L66-L89】 Cleaning buffers between transactions or filtering strictly for FF at the start would avoid immediate aborts.
- **Limited buffering at reader level**: `CANReaderThread` stores per-ID frames in a deque with `maxlen=3`. Under bursty multi-frame traffic, older frames can be evicted before `CANTPSession` consumes them, leading to missing CFs even though they appeared on the bus. The FC is sent, but reassembly fails once evicted frames create gaps and timeouts.【F:CANIF/RWThread/CANReaderThread.py†L9-L58】
- **No SN/block-size enforcement on RX**: Consecutive Frames are appended blindly—sequence-number rollovers, block-size pacing, or unexpected PCI types are not verified. If the ECU sends CFs faster than the host loop can drain, a dropped frame will silently corrupt ordering until the timeout triggers, resembling an abrupt session reset.【F:CANTP/session.py†L104-L116】
- **Per-subscriber queues discarded after idle timeout**: The reader cleanup thread deletes both shared and per-subscriber queues once an ID is idle for 30 seconds. The Log tab still sees the traffic through the default queue, but the CAN-TP subscriber loses its dedicated buffer and never repopulates it, so multi-frame responses vanish from the protocol stack despite being visible in the Log stream.【F:CANIF/RWThread/CANReaderThread.py†L30-L58】【F:CANIF/RWThread/CANReaderThread.py†L74-L100】

## Recommendations
- Gate the first frame retrieval on FF-only when multi-frame responses are expected, or flush stale buffered frames before starting a new diagnostic transaction.
- Expand per-ID buffering (or make it configurable) in `CANReaderThread` so multi-frame bursts cannot evict early CFs before the ISO-TP layer reads them.
- Track and validate CF sequence numbers and block-size behavior in the RX loop; abort with a clear error when gaps or PCI anomalies occur instead of timing out silently.
- Add structured logging around FC send/receive timing and buffer depth to pinpoint whether drops happen before or after `_pop_matching` wakes up.
