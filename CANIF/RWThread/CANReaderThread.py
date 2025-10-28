import threading
import queue
import time
import can
from collections import defaultdict, deque
 
class CANReaderThread(threading.Thread):
    def __init__(self, bus):
        super().__init__(daemon=True)
        self.bus = bus
        self.running = threading.Event()
        self.thread = None
        self.default_queue = deque(maxlen=10)
        self.id_queues = defaultdict(lambda:deque(maxlen=3))
        self.latest_msgs = {}
        self.subscribe_ids = set()
        self.callbacks = {}
        self.id_last_seen = {}
        self.id_timeout = {}
        self.id_timeout_default = 30
        self.cleanup_thread = None
        self.lock = threading.Lock()
 
    def subscribe(self, msg_id, callback=None):
        """
        subscribes to a specific CAN ID. Optionally register a callback to invoke on reception.
        """
        with self.lock:
            self.subscribe_ids.add(msg_id)
            if callback:
                self.callbacks[msg_id] = callback
   
    def unsubscribe(self, msg_id):
        """
        Unsubscribe a CAN ID
        """
        with self.lock:
            self.subscribe_ids.discard(msg_id)
            self.callbacks.pop(msg_id,None)
            self.id_queues.pop(msg_id,None)
            self.latest_msgs.pop(msg_id,None)
   
    def get_from_default(self, pop=True):
        """Get a message from the default queue"""
        with self.lock:
            if self.default_queue:
                return self.default_queue.popleft() if pop else self.default_queue[0]
 
    def get_from_id(self, msg_id, pop=True):
        """Get a message from a specific CAN ID queue"""
        messgae_id = int(msg_id,16)
        with self.lock:
            try:
                return self.id_queues[messgae_id].popleft() if pop else self.id_queues[messgae_id][0]
            except:
                return None
   
    def get_latest(self, msg_id):
        """Return the most recent message with this ID (non-blocking)."""
        try:
            return self.latest_msgs.get(msg_id)
        except:
            return None
 
    def wait_for(self, msg_id, timeout=1.0):
        """Block until a message with the given ID is received, or timeout"""
        end_time = time.time() + timeout
        while time.time() < end_time:
            msg = self.get_from_id(msg_id, pop=False)
            if msg:
                return msg
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
        self.cleanup_thread = threading.Thread(target=self.cleanup_old_queues)
        self.cleanup_thread.start()
        while self.running.is_set():
            msg = self.bus.recv(timeout=10)
            if msg is None:
                continue
            msg_id = msg.arbitration_id
            with self.lock:
                self.default_queue.append(msg)
                self.latest_msgs[msg_id] = msg
                self.id_last_seen[msg_id] = time.time()
                if msg_id in self.id_queues:
                    self.id_queues[msg_id].append(msg)
                else:
                    self.id_queues[msg_id] = [msg]
                if msg_id in self.subscribe_ids:
                    for cb in self.callbacks[msg_id]:
                        try:
                            cb(msg)
                        except Exception as e:
                            print(f"Callback error for ID {msg_id}: {e}")
   
    def stop(self):
        self.running.clear()
        self.cleanup_thread.join()