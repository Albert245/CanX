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
test_dbc = "input/20240828_STD_DB_CAR_R2.0_2024_FD_E_v24.08.01_Remove_MKBD_HU_03_05.dbc"
 
start = time.time()
 
CanIf = CANInterface(device="PCAN",channel=0, is_fd=False)
CanIf.initialize_bus()
ComDia = ComDiag(canif=CanIf, ecu_id=physical_addr, tester_id=tester_addr)
ComDia.set_dll(dll_path)
 
#===========[ TESTING ]==================================
# enable_high_res_timer()
CanIf.import_dbc(test_dbc)
start_time = time.time()
 
#--------------------------------------------------------
#-----------[ Diag testing ]-----------------------------
# put Diag your code here
 
# send = ComDia.send_and_received("1003",ecu_id=physical_addr)
# ComDia.start_tester_present(ecu_id=functional_addr)
# send = ComDia.send_and_received("22f187",ecu_id=physical_addr)
# ComDia.unlock_security()
# print(f"ComDia: {send}")
# time.sleep(3)
# ComDia.stop_tester_present()
 
#--------------------------------------------------------
#-----------[ Send periodic by message]------------------
 
 
CanIf.start_periodic_by_message(message_name_or_id="DATC_04_200ms")
CanIf.start_periodic_by_message(message_name_or_id="DATC_17_200ms")
# for i in range(0,80,1):
#     signals_04 = {"DATC_RrDrvTempCDis":(i*0.5 + 14)}
#     CanIf.update_periodic("DATC_04_200ms", signals_04)
   
#     signals_17 = {"DATC_FrontPwmIsVolt":(i*0.02)}
#     CanIf.update_periodic("DATC_17_200ms", signals_17)
   
#     time.sleep(2)
 
#--------------------------------------------------------
#-----------[ Send periodic by node]---------------------
# CanIf.start_periodic_by_node(node_name="DATC", except_msg=["DATC_GST", "NM_DATC"],role="receiver")
# time.sleep(5)
# print("reset")
# CanIf.reset_periodic_by_node(node_name="DATC", except_msg=["DATC_GST", "NM_DATC"],role="receiver")
 
#--------------------------------------------------------
 
while(time.time()-start_time<15):
    continue
   
#===========[ END ]====================
print("Shutdown bus...")
CanIf.shutdown_bus()
 