# file: scheduler/crc_cy.pyx
# distutils: language = c

cimport cython

@cython.boundscheck(False)
@cython.wraparound(False)
cpdef unsigned short crc16_canfd_cy(unsigned char[:] data):
    """
    Compute CRC-16 for CAN FD frame.
    Equivalent to software CRC but runs in C for better performance.
    """

    cdef unsigned short CRC_16_INIT = 0xFFFF
    cdef unsigned short CRC_16_POLY = 0x1021
    cdef unsigned short CRC_16_FINAL_XOR = 0xFFFF

    cdef unsigned short crc = CRC_16_INIT
    cdef int i, j
    cdef unsigned short bitmask

    for i in range(data.shape[0]):
        crc ^= (data[i] << 8)
        for j in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ CRC_16_POLY
            else:
                crc <<= 1
            crc &= 0xFFFF

    crc ^= CRC_16_FINAL_XOR
    return crc
