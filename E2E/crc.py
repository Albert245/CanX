'''
Author: NhatPM7
Description: This lib provide crc calulate functions
Last update: 22-Jan-2025
    - First Initial
'''
from E2E.CRC.crc_cy import crc16_canfd_cy

CRC_17_POLY = 0x1685B
CRC_17_INIT = 0x1FFFF
CRC17_WIDTH = 17

CRC_16_POLY = 0x1021
CRC_16_INIT = 0xFFFF
CRC_16_FINAL_XOR = 0x0
CRC16_WIDTH = 16


def reflect(data, n_bits):
    reflection = 0
    for _ in range(n_bits):
        reflection = (reflection << 1) | (data & 1)
        data >>= 1
    return reflection
 
def crc17_canfd(data):
    crc = CRC_17_INIT
    for byte in data:
        crc ^= (_REFLECT_BYTE[byte] << (CRC17_WIDTH - 8))
        for _ in range(8):
            if crc & (1 << (CRC17_WIDTH - 1)):
                crc = (crc<<1)^CRC_17_POLY
            else:
                crc <<= 1
    crc &= (1 << CRC17_WIDTH) - 1
    return reflect(crc, CRC17_WIDTH)
 
def crc16_canfd(data):
    crc = CRC_16_INIT
    for byte in data:
        crc ^= (byte << (CRC16_WIDTH - 8))
        for _ in range(8):
            if crc & (1 << (CRC16_WIDTH - 1)):
                crc = (crc<<1)^CRC_16_POLY
            else:
                crc <<= 1
    crc &= (1 << CRC16_WIDTH) - 1
    crc ^= CRC_16_FINAL_XOR
    return crc

def hex2byte(hex_str):
    hex_str = hex_str.strip().replace(" ", "")
    if len(hex_str) % 2:
        hex_str = "0" + hex_str
    return bytes.fromhex(hex_str)


def _build_crc_payload(msg_id, data_frame):
    try:
        msg_id = int(msg_id)
    except (TypeError, ValueError):
        raise TypeError("msg_id must be an integer value") from None
    if msg_id < 0:
        raise ValueError("msg_id must be non-negative")
    if not isinstance(data_frame, (bytes, bytearray, memoryview)):
        raise TypeError("data_frame must be bytes-like")
    if len(data_frame) < 2:
        raise ValueError("data_frame must contain at least two bytes")
    suffix = (0xF800 + msg_id) & 0x0FFF
    payload = bytearray(data_frame[2:])
    payload.append(suffix & 0xFF)
    payload.append((suffix >> 8) & 0xFF)
    return bytes(payload)


def crc_calculate(msg_id, data_frame):
    """
    msg_id : int (Eg: 0x7b3)
    data_frame : bytes (Eg: b'\x00\x00\x00')
    """
    payload = _build_crc_payload(msg_id, data_frame)
    return crc16_canfd(payload)


def crc_calculate_cy(msg_id, data_frame):
    """
    msg_id : int (Eg: 0x7b3)
    data_frame : bytes (Eg: b'\x00\x00\x00')
    """
    payload = _build_crc_payload(msg_id, data_frame)
    return crc16_canfd_cy(payload)


_REFLECT_BYTE = tuple(reflect(i, 8) for i in range(256))
