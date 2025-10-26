"""
Author: NhatPM7
Description: This module handles communication diagnostics for the ECU.
Last update: 22-Jan-2025
    - Added threading for non-blocking Tester Present loop.
"""
 
import threading
import time
from CANTP.CANTP import CANTP
from CANIF.CANInterface import CANInterface
from proxy_dll.Generate_key_from_dll import *
from COMMON.Cast import *
from CANTP.Frame import *
class ComDiag:
    def __init__(self, canif: CANInterface, ecu_id: str, tester_id: str, dll = None):
        """
        Initializes the Communication Diagnostics module.
 
        :param cantp: Instance of CANTP.
        :param tester_id: CAN ID of the tester (e.g., '7BB').
        :param ecu_id: CAN ID of the ECU (e.g., '7B3').
        """
        if not isinstance(canif, CANInterface):
            raise TypeError(f"Expected cantp to be an instance of CANTP, but got {type(canif).__name__}.")
        self.canif = canif
        self.cantp = CANTP(CanIF=canif, padding='00')
        self.tester_id = tester_id
        self.ecu_id = ecu_id
        self.keep_alive = False
        self.thread = None  # Thread for Tester Present
        self.dll = dll
 
    def set_dll(self,dll_path):
        self.dll = dll_path
 
    def send(self,msg,lenght=8,ecu_id=None):
        if not ecu_id:
            ecu_id = self.ecu_id
        return self.cantp.send(ecu_id, self.tester_id, msg)
   
    def receive(self, timeout=300):
        """
        Receive message on CAN
        param:  msg: message need to send
                timeout: time for waiting response
        """
        recv = self.cantp.receive(self.ecu_id, self.tester_id, timeout)
        if recv and (len(recv)>0):
            if NRC_check(recv):
                if int(recv[2],16) == 0x78:
                    recv = self.receive(timeout=timeout)
        return recv
   
    def send_and_received(self, raw_msg,ecu_id='7B3', lenght=8, timeout=300):
        """
        Function send Diag request and return matched SID
        """
        raw_msg = raw_msg.strip()
        msg = raw_msg.replace(' ','')
        SID = msg[:2]
        send = self.send(raw_msg,lenght=lenght,ecu_id=ecu_id)
        start_time = time.time()
 
        if not send:
            return None
        recv = self.receive(timeout=timeout)
        while (not recv) and (time.time() - start_time < (timeout/1000)):
            recv = self.receive(timeout=timeout)
 
        if not recv:
            return None
        pos_SID = Hex(int(recv[0],16) - 0x40)
        if recv[1] == SID or pos_SID == SID:
            return recv
        return None
 
    def send_tester_present(self,ecu_id):
        """
        Sends a Tester Present (0x3E 00) message to the ECU.
        This keeps the diagnostic session active.
 
        :return: True if successful, False otherwise.
        """
        tester_present_msg = "3E 80"
        # print(f"Sending Tester Present to ECU {self.tester_id}...")
        return self.send(tester_present_msg,ecu_id=ecu_id)
 
    def _tester_present_loop(self, interval, ecu_id):
        """Internal method to send Tester Present messages in a loop."""
        interval_sec = interval / 1000  # Convert to seconds
        # print(f"Starting Tester Present loop every {interval} ms...")
 
        while self.keep_alive:
            success = self.send_tester_present(ecu_id)
            if not success:
                print("Warning: Tester Present message failed!")
            time.sleep(interval_sec)
        print("Stopped Tester Present")
 
    def start_tester_present(self, interval=2000,ecu_id=None):
        """
        Starts sending Tester Present messages periodically in a separate thread.
       
        :param interval: Time interval between messages in milliseconds (default 2000ms).
        """
        if not ecu_id:
            ecu_id = self.ecu_id
        if self.thread and self.thread.is_alive():
            print("Tester Present loop is already running!")
            return
 
        self.keep_alive = True
        self.thread = threading.Thread(target=self._tester_present_loop, args=(interval,ecu_id,), daemon=True)
        self.thread.start()
 
    def stop_tester_present(self):
        """
        Stops sending Tester Present messages.
        """
        if not self.keep_alive:
            print("Tester Present loop is not running.")
            return
 
        print("Stopping Tester Present loop...")
        self.keep_alive = False
        if self.thread:
            self.thread.join()  # Ensure the thread stops cleanly
   
    def get_key(self,req):
        if not self.dll:
            return None
        seed = StrArr2Int(req[2:])
        key = ASK_KeyGenerate(dll_path=self.dll,seed=seed)
        try:
            key_check = int(key,16)
            return key
        except:
            print(f"ERROR: key return: {key}")
            return None
 
    def unlock_security(self,ecu_id = '7B3'):
        """
        Unlock security by service $27
        """
        recv = self.send_and_received("27 11",ecu_id=ecu_id)
        if not recv:
            print("Timeout - Seca")
            return False
        if NRC_check(recv):
            print(f"NRC: {recv}")
            return False
        # print(recv)
        key = self.get_key(recv)
        if not key:
            print("ERROR: generate key failed")
            return False
        recv = self.send_and_received("27 12" + key,ecu_id=ecu_id)
        if NRC_check(recv):
            print("ERROR: wrong key")
            print(f"NRC: {recv}")
            return False
        print("INFO: Seca Unlocked")
        return True
   
    def send_periodic(self,ecu_id, raw_data, period, duration = None):
        msg = [ecu_id,raw_data]
        return self.canif.write_periodic(message=msg, period=period, duration= duration)
   
    def stop_periodic(self,ecu_id):
        return self.canif.stop_all_periodic()