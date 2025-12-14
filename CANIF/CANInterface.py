"""
Author: NhatPM7
Description: This lib represent for CAN Interface layer
Last update: 22-Jan-2025
    - First Initial
"""
 
import can
import time
from COMMON.Cast import *
from CANIF.RWThread.CANReaderThread import *
from CANIF.RWThread.CANWriterScheduler import*
from CANIF.RWThread.FileWriterThread import FileWriterThread
from E2E.DbcAdapter import DBCAdapter
from typing import Union, Any, Optional, Callable
import ctypes
import atexit
import queue
from pathlib import Path
from logger.log import logger
 
timeBeginPeriod = ctypes.windll.winmm.timeBeginPeriod
timeEndPeriod = ctypes.windll.winmm.timeEndPeriod
 
def enable_high_res_timer():
    timeBeginPeriod(1)
    atexit.register(disable_high_res_timer)
def disable_high_res_timer():
    timeEndPeriod(1)

class MockBus:
    def __init__(self):
        self.tx_queue = queue.Queue()
        self.rx_queue = queue.Queue()

    def send(self, msg: can.Message):
        logger.info(f"[MockBus] Sent: {msg}")
        # Tự loopback để test
        self.rx_queue.put(msg)

    def recv(self, timeout=None):
        try:
            msg = self.rx_queue.get(timeout=timeout)
            logger.info(f"[MockBus] Received: {msg}")
            return msg
        except queue.Empty:
            return None

    def shutdown(self):
        logger.info("[MockBus] Closed.")
 
class CANInterface:
    def __init__(self, device,is_fd = False, channel = 0, padding = '00', dbc_path: Optional[str] = None):
        self.bus = None
        self.device = device
        self.channel = channel
        self.messages_periodic = {}
        self.is_fd = is_fd
        self.padding = padding
        self.reader = None
        self.scheduler = None
        self.dbc = DBCAdapter(dbc_path) if dbc_path else None
        self.dbc_check = True if dbc_path else False
        self.nonDBC_messages = {}
        enable_high_res_timer()
        self._tx_hook: Optional[Callable[[can.Message], None]] = None
        self._file_writer: Optional[FileWriterThread] = None
        self._log_directory = Path("logs")
        self.log_active: bool = False
        self.trace_queue: queue.Queue = queue.Queue(maxsize=500)
        self.ui_trace_queue: queue.Queue = queue.Queue(maxsize=500)
        self.trace_enqueued_count: int = 0
        self.trace_dropped_count: int = 0
        self._trace_emit_callback: Optional[Callable[[can.Message, str], None]] = None
        self.ui_log_enabled: bool = True

    def set_tx_hook(self, callback: Optional[Callable[[can.Message], None]]) -> None:
        """Register a callback invoked whenever a CAN frame is transmitted."""
        self._tx_hook = callback

    def set_trace_emit_callback(self, callback: Optional[Callable[[can.Message, str], None]]) -> None:
        """Optional hook invoked when a trace frame is dispatched (UI helper)."""
        self._trace_emit_callback = callback

    def _bounded_put(self, target_queue: queue.Queue, item, *, count_stats: bool = False) -> bool:
        try:
            target_queue.put_nowait(item)
            if count_stats:
                self.trace_enqueued_count += 1
            return True
        except queue.Full:
            try:
                target_queue.get_nowait()
            except queue.Empty:
                pass
            if count_stats:
                self.trace_dropped_count += 1
            try:
                target_queue.put_nowait(item)
                if count_stats:
                    self.trace_enqueued_count += 1
                return True
            except queue.Full:
                logger.debug("Trace queue saturated; dropping frame")
                return False

    def _trace_put(self, item: tuple[can.Message, str]) -> None:
        self._bounded_put(self.trace_queue, item, count_stats=True)

    def _ui_trace_put(self, item: tuple[can.Message, str]) -> None:
        self._bounded_put(self.ui_trace_queue, item, count_stats=False)

    def _notify_tx(self, message: can.Message) -> None:
        if not self._tx_hook and not self.log_active:
            return
        try:
            if self._tx_hook:
                self._tx_hook(message)
        except Exception:
            pass
        if self.log_active:
            self._trace_put((message, "tx"))
            if self.ui_log_enabled:
                self._ui_trace_put((message, "tx"))

    def _on_trace_rx(self, message: can.Message) -> None:
        if not self.log_active:
            return
        self._trace_put((message, "rx"))
        if self.ui_log_enabled:
            self._ui_trace_put((message, "rx"))
        if self._trace_emit_callback:
            try:
                self._trace_emit_callback(message, "rx")
            except Exception:
                logger.debug("Trace emit callback failed", exc_info=True)

    def _drain_trace_queue(self) -> None:
        for q in (self.trace_queue, self.ui_trace_queue):
            try:
                while True:
                    q.get_nowait()
            except queue.Empty:
                continue
 
    def initialize_bus(self):
        """Initialize the CAN bus based on the selected device."""
        try:
            if self.device == "PCAN":
                # PCAN initialization
                self.bus = can.Bus(interface='pcan', channel=f'PCAN_USBBUS{self.channel+1}',bitrate=500000, fd=self.is_fd,f_clock=80000000,nom_brp=2,nom_tseg1=63,nom_tseg2=16,nom_sjw=16,data_brp=2,data_tseg1=15,data_tseg2=4,data_sjw=4,auto_reset=True)
                self.reader = CANReaderThread(self.bus)
                self.scheduler = SmartCanMessageScheduler(self.bus)
                self.reader.start()
            elif self.device == "CANalyzer":
                # CANalyzer initialization
                self.bus = can.Bus(interface='vector', app_name='CANalyzer', channel=self.channel, bitrate=500000, data_bitrate=2000000, fd=self.is_fd)
                self.reader = CANReaderThread(self.bus)
                self.scheduler = SmartCanMessageScheduler(self.bus)
                self.reader.start()
            elif self.device == "CANoe":
                # CANoe initialization
                self.bus = can.Bus(interface='vector', app_name='CANoe', channel=self.channel, bitrate=500000, data_bitrate=2000000, fd=self.is_fd)
                self.reader = CANReaderThread(self.bus)
                self.scheduler = SmartCanMessageScheduler(self.bus)
                self.reader.start()
            elif self.device == "CANape":
                # CANoe initialization
                self.bus = can.Bus(interface='vector', app_name='CANape', channel=self.channel, bitrate=500000, data_bitrate=2000000, fd=self.is_fd)
                self.reader = CANReaderThread(self.bus)
                self.scheduler = SmartCanMessageScheduler(self.bus)
                self.reader.start()
            elif self.device == "VirtualCAN":
                logger.info("Using Virtual CAN Bus")
                self.bus = can.interface.Bus(bustype="virtual")
                self.reader = CANReaderThread(self.bus)
                self.scheduler = SmartCanMessageScheduler(self.bus)
                self.reader.start()

            elif self.device == "MockCAN":
                logger.info("Using Mock CAN Bus (no hardware)")
                self.bus = MockBus()
                self.reader = CANReaderThread(self.bus)
                self.scheduler = SmartCanMessageScheduler(self.bus)
                self.reader.start()
            else:
                raise ValueError("Unsupported device selected!")
            if self.reader:
                self.reader.set_trace_hook(self._on_trace_rx)
            enable_high_res_timer()
        except Exception as e:
            logger.error(f"ERROR: CANInterface - Failed to initialize CAN bus: {e}.")
   
    def read(self, message_id, timeout = 1000):
        """
        Read funtion: Read message on CAN bus base-on message ID
        param:  message_id : str (Eg: 6bb)
                timeout : int (ms)
                ret : ['62','F1','00']
        """
        if not self.bus:
            logger.error("ERROR: CANInterface - CAN bus is not initialized.")
            return None
        if not self.reader:
            logger.error("ERROR: CANInterface - CAN reader thread is not running.")
            return None
        timeout_sec = timeout / 1000.0
        deadline = time.monotonic() + timeout_sec
        if isinstance(message_id, str):
            try:
                msg_key = int(message_id, 16)
            except ValueError:
                logger.error(f"ERROR: CANInterface - Invalid message id '{message_id}'.")
                return None
        else:
            try:
                msg_key = int(message_id)
            except (TypeError, ValueError):
                logger.error(f"ERROR: CANInterface - Invalid message id '{message_id}'.")
                return None
        try:
            self.reader.track_id(msg_key)
            while True:
                if time.monotonic() > deadline:
                    break
                msg = self.reader.get_from_id(msg_id=msg_key)
                if msg :
                    logger.info(f"<-{Hex(msg.arbitration_id)}: {HexArr2Str(msg.data)}")
                    return HexArr2StrArr(msg.data)
                time.sleep(0.001)
            return None
        except Exception as e:
            logger.error(f"Error reading CAN message: {e}")
            return None
 
    def write(self, message_id, raw_data,padding = None, is_fd = None):
        """
        Write function: Send message on CAN-CANFD bus  
        param:  raw_data = '22 F1 00'
                message_id : str
                is_fd : bool
                lenght : len of message
        """
        is_fd = self.is_fd if is_fd is None else is_fd
 
        if not self.bus:
            logger.error("Error: CAN bus is not initialized.")
            return False
        try:
            can_id = int(message_id,16)
            data = Str2HexArr(raw_data) # Convert '22 F100' --> [0x22, 0xF1, 0x00] (hex)
            if not padding:
                padding = self.padding
            if self.is_fd:
                data = add_padding(data,padding=padding)
 
            msg = can.Message(arbitration_id=can_id, data=data, is_extended_id=False, is_fd=self.is_fd)
            self.bus.send(msg)
            self._notify_tx(msg)
            logger.info(f"->{message_id}: {raw_data}")
            return True
        except can.CanError as e:
            logger.error(f"Error sending CAN <{message_id}>: {raw_data}")
            return False
 
    def write_periodic(self, message:list, period:int, duration = None, is_fd = None, is_extended_id = False):
        """
        Write function periodic: Send message not in dbc on periodic time
        Args:  messages (list) : list of [message_id, raw_data]
                period (int) : Interval in ms
                duration (int, optional) : Approximate duration in seconds to continue sending messages. If no duration is provided, the task will continue indefinitely.
        """
        if not message:
            logger.error("Error: Empty message list for write_periodic")
            return False
        if is_fd == None:
            is_fd = self.is_fd
        if not self.bus:
            logger.error("Error: CAN bus is not initialized.")
            return False
       
        try:
            period = period / 1000
            msg_id = int(message[0],16)
            self.nonDBC_messages[msg_id] = message[1]
            if duration:
                duration = duration / 1000
                self.scheduler.add_message(
                    msg_id = msg_id,
                    period = period,
                    is_fd = is_fd,
                    is_extended_id = is_extended_id,
                    get_payload = lambda:self._dump_payload(msg_id),
                    duration = duration,
                    on_sent = self._notify_tx,
                )
            else:
                self.scheduler.add_message(
                    msg_id = msg_id,
                    period = period,
                    is_fd = is_fd,
                    is_extended_id = is_extended_id,
                    get_payload = lambda:self._dump_payload(msg_id),
                    on_sent = self._notify_tx,
                )
 
            return True
        except can.CanError as e:
            logger.error(f"Error sending CAN <{message[0]}>: {message[1]}")
            return False
 
    def import_dbc(self, dbc_path):
        self.dbc = DBCAdapter(dbc_path)
        self.dbc_check = True
 
    def start_periodic_by_message(self, message_name_or_id, period:int = None, duration = None, is_fd = None):
        if not message_name_or_id:
            logger.error("Error: Empty message name for start_periodic_by_message_name")
            return False
        if is_fd == None:
            is_fd = self.is_fd
        if not self.scheduler:
            logger.error("Scheduler not initialized")
            return False
        if not self.dbc:
            logger.error("DBC not loaded")
            return False
        if not self.bus:
            logger.error("Error: CAN bus is not initialized.")
            return False
 
        message = self.get_msg_att(message_name_or_id)
        msg_name = message.name
        msg_id = message.frame_id
        is_extended_id = message.is_extended_frame
 
        if period is None:
            period = message.cycle_time
        if duration:
            duration = duration/1000
        try:
            period = period/1000
        except:
            period = 0
            duration = 1
           
        self._start_periodic_by_message_id(msg_id = msg_id, period = period, duration = duration, is_extended_id = is_extended_id, is_fd = is_fd)
   
    def stop_periodic(self, message_name_or_id):
        if not self.scheduler:
            return False
        msg_id = None
        try:
            if isinstance(message_name_or_id, int):
                msg_id = int(message_name_or_id)
            elif isinstance(message_name_or_id, str):
                token = message_name_or_id.strip()
                if token.lower().startswith("0x"):
                    msg_id = int(token, 16)
                else:
                    try:
                        msg_id = int(token)
                    except ValueError:
                        message = self.get_msg_att(message_name_or_id)
                        msg_id = message.frame_id
            else:
                message = self.get_msg_att(message_name_or_id)
                msg_id = message.frame_id
        except Exception:
            message = self.get_msg_att(message_name_or_id)
            msg_id = getattr(message, "frame_id", None)
        if msg_id is None:
            return False
        try:
            self.scheduler.stop_message(int(msg_id))
            return True
        except Exception:
            return False
   
    def reset_message(self, message_name):
        self.dbc.reset_message(message_name)
   
    def reset_all_messages(self):
        self.dbc.reset_message()
   
    def pause_periodic(self, message_name_or_id = None):
        if msg_id:
            message = self.get_msg_att(message_name_or_id)
            msg_id = message.frame_id
            self.scheduler.pause(msg_id)
        else:
            self.scheduler.pause_all()
   
    def resume_periodic(self, message_name_or_id = None):
        if msg_id:
            message = self.get_msg_att(message_name_or_id)
            msg_id = message.frame_id
            self.scheduler.resume(msg_id)
        else:
            self.scheduler.resume_all()
   
    def _start_periodic_by_message_id(self, msg_id, period:int = None, duration = None, is_fd = None, is_extended_id = False):
 
        def _get_payload():
            return self.dbc.get_payload(msg_id)
       
        self.scheduler.add_message(
            msg_id = msg_id,
            period = period,
            is_extended_id = is_extended_id,
            is_fd = is_fd,
            get_payload = _get_payload,
            duration = duration,
            on_sent = self._notify_tx,
        )
   
    def start_periodic_by_node(self, node_name, duration = None, except_msg = [], role = "sender"):
        if role == "sender":
            nodes = self.get_nodes_in_DBC()
        elif role == "receiver":
            nodes = self.get_receivers_in_DBC()
        node = nodes[node_name]
        for message in node:
            if message not in except_msg:
                self.start_periodic_by_message(message, duration = duration)
 
    def stop_periodic_by_node(self, node_name, duration = None, except_msg = [], role = "sender"):
        if role == "sender":
            nodes = self.get_nodes_in_DBC()
        elif role == "receiver":
            nodes = self.get_receivers_in_DBC()
        node = nodes[node_name]
        for message in node:
            if message not in except_msg:
                self.stop_periodic(message)
   
    def reset_periodic_by_node(self, node_name, except_msg = [], role = "sender"):
        if role == "sender":
            nodes = self.get_nodes_in_DBC()
        elif role == "receiver":
            nodes = self.get_receivers_in_DBC()
        node = nodes[node_name]
        for message in node:
            if message not in except_msg:
                self.reset_message(message)
   
    def start_periodic_all_nodes(self, duration = None):
        nodes = self.get_nodes_in_DBC()
        for node in nodes:
            for message in node:
                self.start_periodic_by_message(message, duration = duration)
   
    def stop_periodic_all_nodes(self):
        nodes = self.get_nodes_in_DBC()
        for node in nodes:
            for message in node:
                self.stop_periodic(message)
 
    def _dump_payload(self, msg_id):
        return Str2HexArr(self.nonDBC_messages[msg_id])
 
    def _Messages(self):
        return self.dbc.Messages_Obj()
   
    def get_msg_att(self,msg_id_or_name):
        return self.dbc.Message_attributes(msg_id_or_name)
   
    def get_messages_in_DBC(self):
        return self.dbc.Messages()
   
    def get_current_signals_queue(self, msg_name):
        return self.dbc.Message_dict(msg_name)
   
    def get_nodes_in_DBC(self):
        return self.dbc.Nodes()
   
    def get_receivers_in_DBC(self):
        return self.dbc.Receivers()
 
    def update_periodic_nonDBC(self, msg_id, raw_data, burst = False):
        self.nonDBC_messages[msg_id] = raw_data
        return True
 
    def update_periodic(self, message_name: str, signals: Dict[str,Any]) -> bool:
        self.dbc.push_signals(message_name, signals)
        burst_triggered = False
        if self.dbc.isOnEvent(message_name) and self.scheduler:
            msg_id = self.dbc.get_message_id_by_name(message_name)
            task_exists = bool(self.scheduler.tasks.get(msg_id)) if hasattr(self.scheduler, "tasks") else False
            if task_exists:
                self.scheduler.trigger_burst(msg_id)
                burst_triggered = True
        return burst_triggered
 
    def stop_all_periodic(self):
        self.scheduler.stop_all()
        return True
   
    def Tranceiver_status(self):
        return self.scheduler.get_status()
   
    def subscribe_id_queue(self, msg_id, callback = None, queue_name: str | None = None):
        """
        Subscribe to a message ID queue so the frame is buffered separately from the default queue.
        Args:   msg_id (str|int) : message id
                callback (callable|None): optional callback invoked on reception.
                queue_name (str|None): optional dedicated queue namespace to avoid sharing
                    frames with other consumers.
        """
        if not self.reader:
            logger.error("ERROR: CANInterface - CAN reader thread is not initialized.")
            return
        try:
            self.reader.subscribe(msg_id, callback, queue_name=queue_name)
        except ValueError as exc:
            logger.error(f"ERROR: CANInterface - {exc}")

    def unsubscribe_id_queue(self, msg_id, queue_name: str | None = None):
        """
        Unsubscribe a message id queue.
        Args:   msg_id (str|int) : message id
                queue_name (str|None): optional dedicated queue namespace.
        """
        if not self.reader:
            logger.error("ERROR: CANInterface - CAN reader thread is not initialized.")
            return
        try:
            self.reader.unsubscribe(msg_id, queue_name=queue_name)
        except ValueError as exc:
            logger.error(f"ERROR: CANInterface - {exc}")

    def reset_id_queue(self, msg_id, queue_name: str | None = None):
        """
        Clear buffered frames for a message id queue to avoid stale data.
        Args:   msg_id (str|int) : message id
                queue_name (str|None): optional dedicated queue namespace.
        """
        if not self.reader:
            logger.error("ERROR: CANInterface - CAN reader thread is not initialized.")
            return
        try:
            self.reader.reset_queue(msg_id, queue_name=queue_name)
        except ValueError as exc:
            logger.error(f"ERROR: CANInterface - {exc}")

    def read_all(self, timeout = 1000):
        """
        Read function: Read any message on CAN bus from the default queue.
        param:  timeout : int (ms)
                ret : ['62','F1','00'] or None if timeout
        """
        if not self.bus:
            logger.error("ERROR: CANInterface - CAN bus is not initialized.")
            return None
        if not self.reader:
            logger.error("ERROR: CANInterface - CAN reader thread is not running.")
            return None
        timeout_sec = timeout / 1000.0
        deadline = time.monotonic() + timeout_sec
        try:
            while True:
                if time.monotonic() > deadline:
                    break
                msg = self.reader.get_from_default()
                if msg:
                    logger.info(f"<-{Hex(msg.arbitration_id)}: {HexArr2Str(msg.data)}")
                    return HexArr2StrArr(msg.data)
                time.sleep(0.001)
            return None
        except Exception as e:
            logger.error(f"Error reading CAN message: {e}")
            return None

    def start_log(self, log_path: Optional[str] = None, enable_ui: bool = True) -> Optional[str]:
        """Enable trace logging without restarting the CAN reader thread."""
        if not self.reader:
            logger.error("ERROR: CANInterface - CAN reader thread is not initialized.")
            return None
        try:
            if self.log_active:
                self.stop_log()
            target_path = Path(log_path) if log_path else self._log_directory / f"trace_{int(time.time())}.log"
            target_path.parent.mkdir(parents=True, exist_ok=True)
            self.trace_enqueued_count = 0
            self.trace_dropped_count = 0
            self.ui_log_enabled = bool(enable_ui)
            self._drain_trace_queue()
            if self._file_writer:
                self._file_writer.stop_and_join()
            self.log_active = True
            if self.reader:
                self.reader.set_log_active(True)
            self._file_writer = FileWriterThread(self.trace_queue, str(target_path), batch_size=80)
            self._file_writer.start()
            logger.info(f"Start log (ui_enabled={enable_ui}) -> {target_path}")
            return str(target_path)
        except Exception as exc:
            logger.error(f"ERROR: CANInterface - Failed to start log: {exc}")
            self.stop_log()
            return None

    def stop_log(self) -> None:
        """Disable trace logging, clear trace queues, and flush file writer."""
        try:
            self.log_active = False
            if self.reader:
                self.reader.set_log_active(False)
            writer = self._file_writer
            if writer:
                writer.stop_and_join(timeout=2.0)
                self._file_writer = None
            dropped = self.trace_dropped_count
            enqueued = self.trace_enqueued_count
            self._drain_trace_queue()
            logger.info(f"Stop log (enqueued={enqueued}, dropped={dropped})")
        except Exception as exc:
            logger.error(f"ERROR: CANInterface - Failed to stop log: {exc}")
 
    def shutdown_bus(self):
        self.stop_log()
        self.reader.stop()
        logger.info("Reader stopped")
        self.stop_all_periodic()
        logger.info("Writer stopped")
        self.bus.shutdown()
        logger.info("Bus stopped")
        disable_high_res_timer()
