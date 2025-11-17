import threading
import time
import can
from typing import Callable, Dict, Optional, List
from logger.log import*
 
class MessageTask:
    def __init__(self, msg_id: int, period: float, get_payload: Callable[[], List[int]], on_sent: Optional[Callable[[can.Message],None]] = None, is_extended_id:bool = False, is_fd:bool = False, duration = None):
        self.msg_id = msg_id
        self.period = period
        if duration:
            self.duration = duration + time.perf_counter()
        else:
            self.duration = None
        self.get_payload = get_payload
        self.is_extended_id = is_extended_id
        self.is_fd = is_fd
        self.on_sent = on_sent
        self.lock = threading.Lock()

        self.burst_count = 0
        self.burst_spacing = 0.04
        self.next_periodic_time = time.perf_counter()
        self.in_burst_mode = False
        self.running = True
        self.thread = threading.Thread(target=self._send_loop)
        self.thread.daemon = False
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self.pause_event.set()
        self.wake_event = threading.Event()
        self.avr_time = [0,0,0,0]
 
    def start(self, bus: can.Bus):
        self.bus = bus
        self.thread.start()
 
    def stop(self):
        self.running = False
        self.stop_event.set()
        self.pause_event.set()
        self.wake_event.set()
        self.thread.join()
   
    def pause(self):
        self.pause_event.clear()
        logger.info(f"[PAUSE] message id: {hex(self.msg_id)} paused")
   
    def resume(self):
        if not self.running:
            logger.warning(f"[RESUME] message id: {hex(self.msg_id)} is not running")
        self.pause_event.set()
        logger.info(f"[RESUME] message id: {hex(self.msg_id)} resumed")
 
    def trigger_burst(self, count: int = 3, spacing: float = 0.04):
        immediate_burst = False
        with self.lock:
            if self.stop_event.is_set() or not self.pause_event.is_set():
                return
            if not self.running:
                if self.period == 0:
                    immediate_burst = True
                else:
                    return
            else:
                self.burst_count = count
                self.burst_spacing = spacing
                self.in_burst_mode = True
                self.wake_event.set()

        if immediate_burst:
            self._burst_now(count, spacing)
   
    def _send_loop(self):
        while self.running:
            now = time.perf_counter()
            self.pause_event.wait()
            if self.stop_event.is_set():
                break
            if self.duration and (now > self.duration):
                self.running = False
                break
            if self.period == 0 :
                payload = self.get_payload()
                self._send(payload)
                self.running = False
                break
            if self.in_burst_mode:
                for _ in range(self.burst_count):
                    payload = self.get_payload()
                    self._send(payload)
                    if self.stop_event.wait(timeout = self.burst_spacing):
                        break
                self.in_burst_mode = False
                now = time.perf_counter()
                self.next_periodic_time += self.period
                continue
            now = time.perf_counter()
            if now < self.next_periodic_time:
                remaining = self.next_periodic_time - now
                woke = self.wake_event.wait(timeout=remaining)
                if self.stop_event.is_set():
                    break
                if woke:
                    self.wake_event.clear()
                    continue
            self.pause_event.wait()
            with self.lock:
                payload = self.get_payload()
            self._send(payload)
            self.next_periodic_time += self.period

    def _burst_now(self, count: int, spacing: float):
        for index in range(count):
            with self.lock:
                payload = self.get_payload()
            self._send(payload)
            if index < count - 1:
                if self.stop_event.wait(timeout=spacing):
                    break


    def _send(self,payload: List[int]):
        msg = can.Message(arbitration_id=self.msg_id, data=payload, is_extended_id=self.is_extended_id, is_fd=self.is_fd)
        try:
            self.bus.send(msg)
            if self.on_sent:
                self.on_sent(msg)
        except Exception as e:
            logger.error(f"[ERROR] Send {hex(self.msg_id)}: {e}")
 
class SmartCanMessageScheduler:
    def __init__(self, bus: can.Bus):
        self.bus = bus
        self.tasks : Dict[int, MessageTask] = {}
        self.lock = threading.Lock()
 
    def add_message(self, msg_id: int, period: float, get_payload: Callable[[], List[int]], is_extended_id:bool = False, is_fd:bool = False, on_sent: Optional[Callable[[can.Message],None]] = None, duration = None):
        with self.lock:
            if msg_id in self.tasks:
                logger.warning(f"[WARN] Message {hex(msg_id)} already exists. Stop first.")
                return
            task = MessageTask(msg_id=msg_id, period=period, get_payload=get_payload, is_extended_id=is_extended_id, is_fd=is_fd,duration=duration,on_sent=on_sent)
            self.tasks[msg_id] = task
            task.start(self.bus)
 
    def stop_message(self, msg_id: int):
        with self.lock:
            task = self.tasks.pop(msg_id,None)
        if task:
            task.stop()
 
    def trigger_burst(self, msg_id: int, count: int = 3, spacing: float = 0.04):
        with self.lock:
            task = self.tasks.get(msg_id)
            if task:
                task.trigger_burst(count,spacing)
    def pause_all(self):
        with self.lock:
            for task in self.tasks.values():
                task.pause()
    def resume_all(self):
        with self.lock:
            for task in self.tasks.values():
                task.resume()
   
    def pause(self, msg_id):
        with self.lock:
            task = self.tasks.get(msg_id)
            if task:
                task.pause()
            else:
                logger.warning(f"[PAUSE] message id: {hex(msg_id)} not found")
       
    def resume(self, msg_id):
        with self.lock:
            task = self.tasks.get(msg_id)
            if task:
                task.resume()
            else:
                logger.warning(f"[RESUME] message id: {hex(msg_id)} not found")
               
    def stop_all(self):
        with self.lock:
            tasks = list(self.tasks.values())
        self.tasks.clear()
        for task in tasks:
            task.stop()
 
    def get_status(self) -> Dict[int, str]:
        status = {}
        with self.lock:
            for msg_id, task in self.tasks.items():
                if not task.running:
                    s = "stopped"
                elif not task.pause_event.is_set():
                    s = "paused"
                else:
                    s = "running"
                status[msg_id] = s
        return status
