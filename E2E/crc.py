'''
Author: NhatPM7
Description: This lib provide crc calulate functions
Last update: 22-Jan-2025
    - First Initial
'''
from E2E.CRC.crc_cy import crc16_canfd_cy
 
CRC_17_POLY = 0x1685B
CRC_17_INIT = 0x1FFFF
CRC_WIDTH = 17
 
CRC_16_POLY = 0x1021
CRC_16_INIT = 0xFFFF
CRC_16_FINAL_XOR = 0x0
CRC_WIDTH = 16
 
 
def reflect(data, n_bits):
    reflection = 0
    for bit in range(n_bits):
        if data & (1<<bit):
            reflection |= (1<<((n_bits - 1) - bit))
    return reflection
 
def crc17_canfd(data):
    crc = CRC_17_INIT
    for byte in data:
        crc ^= (reflect(byte,8) << (CRC_WIDTH - 8))
        for _ in range(8):
            if crc & (1 << (CRC_WIDTH-1)):
                crc = (crc<<1)^CRC_17_POLY
            else:
                crc <<= 1
    crc &= (1 << CRC_WIDTH) - 1
    return reflect(crc, CRC_WIDTH)
 
def crc16_canfd(data):
    crc = CRC_16_INIT
    for byte in data:
        crc ^= (byte << (CRC_WIDTH - 8))
        for _ in range(8):
            if crc & (1 << (CRC_WIDTH-1)):
                crc = (crc<<1)^CRC_16_POLY
            else:
                crc <<= 1
    crc &= (1 << CRC_WIDTH) - 1
    crc ^= CRC_16_FINAL_XOR
    return crc
 
def hex2byte(hex_str):
    if ((len(hex_str) % 2) != 0):
        hex_str = f"0{hex_str}"
        return bytes.fromhex(hex_str)
    else:
        return bytes.fromhex(hex_str)
 
 
def crc_calculate(msg_id,data_frame):
    """
    msg_id : int (Eg: 0x7b3)
    data_frame : bytes (Eg: b'\x00\x00\x00')
    """
    data_id = (0xF800 + msg_id)&0xFFF
    data_id = f"{data_id:04x}"
    reverse_id = [int(data_id[2:],16) , int(data_id[:2],16)]
    data = list(data_frame[2::]) + reverse_id[::]    
    crc = crc16_canfd(data)
    return crc
 
def crc_calculate_cy(msg_id,data_frame):
    """
    msg_id : int (Eg: 0x7b3)
    data_frame : bytes (Eg: b'\x00\x00\x00')
    """
    data_id = (0xF800 + msg_id)&0xFFF
    data_id = f"{data_id:04x}"
    reverse_id = [int(data_id[2:],16) , int(data_id[:2],16)]
    data = bytes(list(data_frame[2::]) + reverse_id[::])    
    crc = crc16_canfd_cy(data)
    return crc