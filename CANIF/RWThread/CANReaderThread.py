import threading
import queue
import time
import can
from collections import defaultdict, deque
from logger.log import logger
 
class CANReaderThread(threading.Thread):
    def __init__(self, bus):
        super().__init__(daemon=True)
        self.bus = bus
        self.running = threading.Event()
        self.thread = None
        # Use an unbounded thread-safe queue for the default stream so bursts of
        # traffic do not evict older frames before downstream consumers can
        # process them.
        self.default_queue = queue.Queue()
        self.id_queues = defaultdict(lambda:deque(maxlen=3))
        self.latest_msgs = {}
        self.subscribe_ids = set()
        self.callbacks = defaultdict(list)
        self.id_last_seen = {}
        self.id_timeout = {}
        self.id_timeout_default = 30
        self.cleanup_thread = None
        self.lock = threading.Lock()
 
    def subscribe(self, msg_id, callback=None):
        """
        subscribes to a specific CAN ID. Optionally register a callback to invoke on reception.
        """
        try:
            msg_key = self._normalize_id(msg_id)
        except (TypeError, ValueError):
            raise ValueError(f"Unsupported CAN ID: {msg_id!r}") from None
        with self.lock:
            self.subscribe_ids.add(msg_key)
            if callback:
                self.callbacks[msg_key].append(callback)
   
    def unsubscribe(self, msg_id):
        """
        Unsubscribe a CAN ID
        """
        try:
            msg_key = self._normalize_id(msg_id)
        except (TypeError, ValueError):
            raise ValueError(f"Unsupported CAN ID: {msg_id!r}") from None
        with self.lock:
            self.subscribe_ids.discard(msg_key)
            self.callbacks.pop(msg_key,None)
            self.id_queues.pop(msg_key,None)
            self.latest_msgs.pop(msg_key,None)
   
    def get_from_default(self, pop=True, block=False, timeout=None):
        """Get a message from the default queue"""
        try:
            if block:
                return self.default_queue.get(timeout=timeout)
            return self.default_queue.get_nowait()
        except queue.Empty:
            return None
 
    def get_from_id(self, msg_id, pop=True):
        """Get a message from a specific CAN ID queue"""
        try:
            message_id = self._normalize_id(msg_id)
        except (TypeError, ValueError):
            raise ValueError(f"Unsupported CAN ID: {msg_id!r}") from None
        with self.lock:
            queue = self.id_queues.get(message_id)
            if not queue:
                return None
            if pop:
                try:
                    return queue.popleft()
                except IndexError:
                    return None
            try:
                return queue[0]
            except IndexError:
                return None
   
    def get_latest(self, msg_id):
        """Return the most recent message with this ID (non-blocking)."""
        try:
            return self.latest_msgs.get(msg_id)
        except:
            return None
 
    def wait_for(self, msg_id, timeout=1.0):
        """Block until a message with the given ID is received, or timeout"""
        try:
            message_id = self._normalize_id(msg_id)
        except (TypeError, ValueError):
            raise ValueError(f"Unsupported CAN ID: {msg_id!r}") from None
        end_time = time.time() + timeout
        while time.time() < end_time:
            msg = self.get_from_id(message_id, pop=False)
            if msg:
                return msg
            time.sleep(0.001)
        return None
 
    def cleanup_old_queues(self):
        while self.running.is_set():
            now = time.time()
            with self.lock:
                for msg_id in list(self.id_last_seen):
                    msg_timeout = self.id_timeout[msg_id] if msg_id in self.id_timeout else self.id_timeout_default
                    if now - self.id_last_seen[msg_id] > msg_timeout:
                        self.id_queues.pop(msg_id,None)
                        self.latest_msgs.pop(msg_id,None)
                        self.id_last_seen.pop(msg_id,None)
            time.sleep(5)
 
 
    def run(self):
        self.running.set()
        self.cleanup_thread = threading.Thread(target=self.cleanup_old_queues, daemon=True)
        self.cleanup_thread.start()
        while self.running.is_set():
            msg = self.bus.recv(timeout=10)
            if msg is None:
                continue
            msg_id = msg.arbitration_id
            with self.lock:
                self.latest_msgs[msg_id] = msg
                self.id_last_seen[msg_id] = time.time()
                self.id_queues[msg_id].append(msg)
                callbacks = list(self.callbacks.get(msg_id, [])) if msg_id in self.subscribe_ids else []

            self.default_queue.put(msg)
            for cb in callbacks:
                try:
                    cb(msg)
                except Exception as e:
                    logger.error(f"Callback error for ID {msg_id}: {e}")

    def stop(self):
        self.running.clear()
        if self.cleanup_thread:
            self.cleanup_thread.join()
            self.cleanup_thread = None

    @staticmethod
    def _normalize_id(msg_id):
        if isinstance(msg_id, str):
            return int(msg_id, 16)
        return int(msg_id)
