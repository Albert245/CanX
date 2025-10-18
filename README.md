# 🚗 CanX — Universal Smart CAN Real-Time Framework

**CanX** is a modular, high-performance **CAN testing framework** designed to unify hardware from different vendors (Vector, PEAK-System, Kvaser, etc.) into one consistent software layer.

It was created to solve a practical industry problem:  
> 🧩 *“When Vector tools run out of licenses, testing shouldn’t stop.”*

CanX allows you to run the **same automation code**, whether you’re using **Vector CANoe/CANalyzer hardware** or more affordable **PCAN devices**, without modifying a single line of test logic.

---

## ⚙️ Purpose & Motivation

Modern automotive testing setups heavily depend on Vector ecosystems — which are powerful, but expensive and often limited by licensing.  
**CanX** was built to:

- 🧠 **Abstract away vendor dependency** — unify Vector, PCAN, and other CAN hardware under one API  
- 💸 **Reduce testing costs** — enable CAN signal automation without costly licenses  
- 🧰 **Provide a lightweight alternative** — easy to deploy, no GUI or commercial license required  
- 🔄 **Ensure functional equivalence** — replicate essential CANoe/CANalyzer capabilities:  
  - Real-time message sending  
  - DBC-based encoding/decoding  
  - Diag (UDS) message bridging  
  - Periodic / on-event frame scheduling  
  - E2E protection (ALVCNT + CRC)

---

## 🧩 Core Features

| Feature | Description |
|----------|-------------|
| 🔌 **Hardware Abstraction Layer** | Works seamlessly across Vector (CANoe, CANalyzer, VN1611) and PCAN |
| 🧠 **Smart Real-Time Scheduler** | Supports periodic, on-event, and burst transmission with accurate timing |
| 📡 **Dynamic Payload Engine** | Updates CAN frames on-the-fly based on signal inputs or upper-layer events |
| 🧮 **E2E Profile 5 Support** | Auto CRC16 and ALVCNT handling with Cython-optimized calculation |
| 🧱 **Modular Design** | `CANInterface`, `CANTP`, `Diag`, `Scheduler`, `DbcAdapter` modules separated cleanly |
| 🔁 **Live DBC Integration** | Encode/decode signals directly using `cantools` |
| 🧩 **Plug-and-Play Expandability** | Easily integrates GUI, diagnostic stack, or automation test suites |

---

## 🧰 Architecture Overview

```plaintext
┌────────────────────────────────────────────┐
│                  CanX                      │
│────────────────────────────────────────────│
│ CANInterface → Hardware abstraction layer  │
│ CANTP        → Transport protocol handler   │
│ Diag         → UDS / ISO14229 stack         │
│ Scheduler    → Real-time task scheduler     │
│ DbcAdapter   → DBC parser & signal encoder  │
│ CRC Engine   → Cython-optimized E2E logic   │
└────────────────────────────────────────────┘
        ▲
        │
   External Tools / GUI / Automation
```

---

## 🧠 Design Philosophy

> *“Vector power. PCAN simplicity. Open flexibility.”*

CanX is not just a library — it’s a **bridge between proprietary and open automotive ecosystems**.  
It helps engineers and test developers **reuse existing DBCs, diagnostic logic, and message flows** even when Vector tools aren’t available.

**Use Cases**
- ECU simulation and testing without CANoe  
- Python-based diagnostic testers (UDS, ISO-TP)  
- DBC-based signal generators  
- Periodic or on-event CAN automation  
- Real-time monitoring or GUI visualization tools  

---

## 🔌 Supported Hardware

| Hardware Type | Interface | Notes |
|----------------|------------|-------|
| 🧩 Vector VN1611 / CANoe / CANalyzer | `interface='vector'` | Fully supported for FD & Classic |
| 💡 PEAK-System PCAN USB / FD | `interface='pcan'` | Recommended for cost-effective testing |
| 🧱 Kvaser, SocketCAN | `interface='socketcan'` | Experimental support |

CanX automatically adapts timing and frame handling for each hardware type, ensuring identical scheduling behavior.

---

## 🧩 Module Highlights

### 🧠 CANInterface
- Unified abstraction for all hardware  
- Real-time read/write with error handling  
- Periodic send / stop / update control  

### ⏱ Smart Scheduler
- Independent thread per message with accurate timing  
- On-event burst (e.g. 3 frames @ 40ms, then resume periodic)  
- Per-ID pause/resume control  

### 🧩 DBC Adapter
- Integrates with `cantools`  
- Encodes partial signal updates (keeps old values intact)  
- Calculates CRC and ALVCNT when required  
- Resets to initial state when needed  

### 🧮 CRC Engine (Cython)
- CRC16 Profile 5 (AUTOSAR E2E) optimized  
- 140× faster than Python implementation  
- Supports “exclude last two bytes” calculation logic  

---

## 🔧 Development Goals

- [x] Unified multi-vendor CAN interface  
- [x] Real-time scheduler (burst + periodic)  
- [x] CRC16 / ALVCNT generator  
- [x] DBC live encoder & payload queue  
- [x] Pause / Resume per message  
- [x] Cython integration for CRC  
- [ ] GUI layer for visualization  
- [ ] Multi-channel scheduler (VN1611 multi-port)  
- [ ] Diagnostic UDS automation suite  
- [ ] Test reporting with timestamp sync  

---

## 🧑‍💻 Author

**Nhật Phạm (NhatPM7)**  
Embedded Software Engineer — AUTOSAR BSW, Diagnostics & Python Tooling  
📍 Vietnam  
💡 *“From Vector to PCAN — without compromise.”*

---

## 📜 License
MIT License © 2025 — CanX Project