"""
Author: NhatPM7
Description: This lib provide frame proceed functions
Last update: 22-Jan-2025
    - First Initial
"""
from COMMON.Cast import *
from CANTP.Description import *
import math
 
def slice1stChunk(arr, num):
    return arr[:num], arr[num:]
 
#=============== Rx =====================================
def is1stFarme(req:list):
    """
    Check PCI if its first frame
    """
    if req != None:
        if int(req[0],16) >> 4 == 1:
            return True
    return False
 
def calculateLength(msg):
    if (int(msg[1],16) != 0):
        used_len = 2
        value = (((int(msg[0],16) & 0x0F) << 8) | int(msg[1],16))
    else:
        value = 0
        used_len = 5
        value = value | (int(msg[2],16)<< 24)
        value = value | (int(msg[3],16)<< 16)
        value = value | (int(msg[4],16)<< 8)
        value = value | (int(msg[5],16))
    return value, used_len
 
def expectedFrames(msg, chunk_length):
    """
    Calculate expected frame when receive FF from Rx
    """
    data = []
    total_length,used_len = calculateLength(msg)
    data.extend(msg[used_len:])
    return math.ceil(((total_length - len(data)) / (chunk_length-1))), total_length, data
 
def extractCF(msg):
    """
    Extract data from CF frame
    | 0x30 : Flow Status | Block Size | STmin | reserved |
    :param: msg : message received from ECU
    :return:    FCFS : Flow Satus
                FCBS : BS
                FCSTmin : STmin
    """
    FCFS = int(msg[0],16) & 0x3
    FCBS = int(msg[1],16)
    FCSTmin = int(msg[2],16)
    return FCFS, FCBS, FCSTmin
 
def NRC_check(req):
    if req[0] == '7F':
        return True
    return False
 
#=============== Tx =====================================
def increaseSN(SN):
    """
    Increase SN - make sure to wrap around
    """
    if SN < 0xf:
        return SN + 1
    else:
        return 0
 
def convertFF(data:list, chunk_length=8):
    """
    Convert data into FF base on data's length
    """
    data_len = len(data)
    retFF = []
    remain_data = []
    extend_data = []
   
    if data_len <= 0x7:                                     # FF is SF
        retFF.extend([data_len])
        retFF.extend(data)
        retFF.extend([0]*(0x7-data_len))
    elif data_len <= 0xFFF:                                 # FF when 7 < len < 4095
        Byte_0 = 0x10 | ((data_len >> 8) & 0xF)
        Byte_1 = 0xFF & data_len
        extend_data = [Byte_0,Byte_1]
        extend_data.extend(data)
        retFF, remain_data = slice1stChunk(extend_data,chunk_length)
    elif data_len <= 0xFFFFFFFF:                            # FF when len < 4,294,967,295
        Byte_0 = 0x10
        Byte_1 = 0x00
        Byte_2 = 0xFF & (data_len >> 24)
        Byte_3 = 0xFF & (data_len >> 16)
        Byte_4 = 0xFF & (data_len >> 8)
        Byte_5 = 0xFF & data_len
        extend_data = [Byte_0,Byte_1,Byte_2,Byte_3,Byte_4,Byte_5]
        extend_data.extend(data)
        retFF, remain_data = slice1stChunk(extend_data,chunk_length)
    return HexArr2Str(retFF),remain_data
 
def nextCF(SN,data,chunk_length=8):
    """
    Return nextCF for CAN TP
    :param: SN : int SN counter
            data : remain data wait for transmit
    :return: CF, remain data
    """
    ret = []
    extend_data = []
    remain_data = None
    data.extend([0]*(7-len(data)))
    Byte_0 = 0x20 | SN
    extend_data.extend([Byte_0])
    extend_data.extend(data)
    ret, remain_data = slice1stChunk(extend_data,chunk_length)
    return HexArr2Str(ret), remain_data