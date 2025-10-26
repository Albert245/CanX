from CANInterface import *
from ComDia import *
import time
import ctypes
import atexit
 
# =========[ INTIALIZE ]==============
physical_addr = '7B3'
functional_addr = '7DF'
tester_addr = '7BB'
dll_path = r"test.dll"
 
start = time.time()
 
CanIf = CANInterface(device="PCAN",channel=0, is_fd=False)
CanIf.initialize_bus()
ComDia = ComDiag(canif=CanIf, ecu_id=physical_addr, tester_id=tester_addr)
ComDia.set_dll(dll_path)
 
timeBeginPeriod = ctypes.windll.winmm.timeBeginPeriod
timeEndPeriod = ctypes.windll.winmm.timeEndPeriod
 
def enable_high_res_timer():
    timeBeginPeriod(1)
    atexit.register(disable_high_res_timer)
def disable_high_res_timer():
    timeEndPeriod(1)
#===========[ TESTING ]================
 
# put Diag your code here
 
# send = ComDia.send_and_received("1003",ecu_id=physical_addr)
# ComDia.start_tester_present(ecu_id=functional_addr)
# send = ComDia.send_and_received("22f187",ecu_id=physical_addr)
# ComDia.unlock_security()
# print(f"ComDia: {send}")
# time.sleep(3)
# ComDia.stop_tester_present()
 
start_time = time.time()
 
send = CanIf.write_periodic(['7B1','02 10 03'],200,5000)
send = CanIf.write_periodic(['7B2','02 10 03'],200,5000)
send = CanIf.write_periodic(['7B4','02 10 03'],200,5000)
send = CanIf.write_periodic(['7B5','02 10 03'],200,5000)
send = CanIf.write_periodic(['7B6','02 10 03'],200,5000)
send = CanIf.write_periodic(['7B7','02 10 03'],200,5000)
send = CanIf.write_periodic(['7B8','02 10 03'],200,5000)
send = CanIf.write_periodic(['7B9','02 10 03'],200,5000)
send = CanIf.write_periodic(['7BA','02 10 03'],200,5000)
send = CanIf.write_periodic(['7BC','02 10 03'],200,5000)
send = CanIf.write_periodic(['7BD','02 10 03'],200,5000)
send = CanIf.write_periodic(['7BE','02 10 03'],200,5000)
send = CanIf.write_periodic(['7BF','02 10 03'],200,5000)
while(time.time()-start_time<7):
    continue
#===========[ END ]====================
CanIf.shutdown_bus()