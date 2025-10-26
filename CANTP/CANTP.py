"""
Author: NhatPM7
Description: This lib represent for CAN Transport Protocol layer
Last update: 22-Jan-2025
    - First Initial
"""
 
from CANTP.Frame import *
from CANIF.CANInterface import *
from COMMON.Cast import *
import time
 
class CANTP:
    def __init__(self, CanIF:CANInterface, padding = '00'):
        """
        Initialize the CAN Transport Protocol (CANTP) layer.
        :param CanIF: An instance of the CANInterface class.
        """
        if not isinstance(CanIF, CANInterface):
            raise TypeError(f"Expected CanIF to be an instance of CANInterface, but got {type(CanIF).__name__} instead.")
        self.CanIF = CanIF
        self.is_fd = CanIF.is_fd
        self.padding = padding
        self.length = 8
        self.chunk_length = 8
        if self.is_fd == True:
            self.length = 1
            self.chunk_length = 64
 
   
    def _sendFC(self, ecu_id, PCI = 3, FS = 0, BS = 0, STmin = 0x14):
        """
        Send Control Frame - Flow Control
        Byte | Bits | Description
        0    | 0-3  | PCI Type (N_PCI): Identifies the frame as FC
             | 4-7  | FS (Flow Status): Specifies the flow control status
        1    | 8-15 | Block Size: 0 is full
        2    | 16-23| STmin
        3-7  |      | Reserved
        """
        Byte0 = Hex(((PCI << 4) & 0xf0) | (FS & 0x0f))
        Byte1 = Hex(BS)
        Byte2 = Hex(STmin)
        req = f'{Byte0} {Byte1} {Byte2} 00 00 00 00 00'
        return self.CanIF.write(ecu_id, req)
 
    def receive(self, ecu_id, tester_id, timeout = 300):
        """
        Read funtion with Flow Control: Can receive even single frame or multi-frame using CAN TP.
        <- 10 10 62 xx xx xx
        -> 30 00
        param:  ecu_id : str (Eg: '7b3')
                tester_id : str (Eg: '7bb')
                timeout : int (ms)
        return: ['30','00'] - Length removed
        """
        outdata = []
        start_time = time.time()
        stop = False
 
        while (stop == False) and (time.time() - start_time < (timeout/1000)):
            data = self.CanIF.read(tester_id, timeout)
            if not data:
                continue
            if is1stFarme(data):
                expected_frames,total_length,data = expectedFrames(data, self.chunk_length)
                self._sendFC(ecu_id=ecu_id)
                while expected_frames > 0:
                    cf_msg = self.CanIF.read(tester_id, timeout)
                    # Check valid CF
                    if cf_msg and (int(cf_msg[0],16) >> 4) == 0x2:
                        data.extend(cf_msg[1:]) # extend data -> {'1F','FF','62','XX','XX','XX','XX','XX' + ...}
                        expected_frames = expected_frames - 1
                        start_time = time.time()
                    elif not cf_msg:
                        continue
                    else:
                        print("Error: Missing or invalid Consecutive Frame.")
                        print(f"<-{cf_msg}")
                if time.time() - start_time > (timeout/1000):
                    stop = True
                    print("timeout")
                    break
 
                outdata.extend(data[:total_length]) # extend outdata -> {'1F','FF' ['62','XX','XX','XX','XX','XX', ...]} <Ignore PCI and Length from data>
                stop = True
            else:
                outdata.extend(data[1:])
                stop = True
            break
        return outdata
   
    def send(self, ecu_id, tester_id, data, padding = '00'):
        """
        Send function with Flow Control: Send a multi-frame message using CAN TP (for data > 8 bytes).
        :param: ecu_id : str (Eg: '7b3').
                tester_id : str (Eg: '7bb').
                data : str (Eg: '11 22 33 44 ...').
                * Note: data is not included length.
                padding : str '00'
        :return: True if successful, False otherwise.
        """
        # Initial Flow control parameters
        BS = 0
        STmin = 0
        SN = 0
 
        # Convert into FF frame
        raw_data = Str2HexArr(data)
        Frame,remain_data = convertFF(raw_data,self.chunk_length)
 
        if remain_data == []:
            # Frame is SF frame, send SF frame
            return self.CanIF.write(ecu_id,Frame,padding=padding)
 
        else:
            # Frame is FF frame, send FF frame
            self.CanIF.write(ecu_id,Frame,padding=padding)
 
            # Wait for CF frame
            CF  = self.CanIF.read(tester_id, timeout=250)
            if not CF or (int(CF[0],16) >> 4) != 0x3:
                print("Error: Did not receive valid Flow Control frame.")
                return False
 
            # Continue - Extract 1st CF frame
            FCFS,FCBS,FCSTmin = extractCF(CF)
 
            if FCFS == FCFS_CTS:
                BS = FCBS
                STmin = FCSTmin
 
            while remain_data != []:
                # Increase SN counter
                SN = increaseSN(SN) # 1st SN is 1
                # Get next frame
                Frame,remain_data = nextCF(SN,remain_data,self.chunk_length)
                # Send frame
                self.CanIF.write(ecu_id,Frame,padding=padding)
                # Wait STmin
                time.sleep(STmin / 1000)
 
                if BS != 0 and remain_data != []:
                    if SN == BS:
                        # Wait for CF frame
                        CF  = self.CanIF.read(tester_id, timeout=1000)
                        if not CF or (CF[0] >> 4) != 0x3:
                            print("Error: Did not receive valid Flow Control frame.")
                            return False
 
                        # Continue - Extract follow up CF frames
                        FCFS,FCBS,FCSTmin = extractCF(CF)
 
                        if FCFS == FCFS_CTS:
                            BS = FCBS
                            STmin = FCSTmin
 
                        # reset SN counter
                        SN = 0
        return True