# file: scheduler/crc_cy.pyx
# distutils: language = C
 
cimport cython

cdef unsigned short CRC_16_INIT = 0xFFFF
cdef unsigned short CRC_16_POLY = 0x1021
cdef unsigned short CRC_16_FINAL_XOR = 0x0
cdef unsigned short CRC_16_WIDTH = 16
 
cpdef unsigned short crc16_canfd_cy(bytes data):
    """
    Compute CRC-16 for CAN FD frame.
    """
 
    cdef int crc = CRC_16_INIT
    cdef unsigned char b
    cdef int i
 
    for b in data:
        crc ^= (b << (CRC_16_WIDTH-8))
        for i in range(8):
            if crc & 0x8000:
                crc = (crc<<1) ^ CRC_16_POLY
            else:
                crc <<= 1
            crc &= 0xFFFF
    crc ^= CRC_16_FINAL_XOR
    return crc