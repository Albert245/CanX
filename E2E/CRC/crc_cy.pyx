# file: scheduler/crc_cy.pyx
# distutils: language = C
 

cimport cython

cdef unsigned short CRC_16_INIT = 0xFFFF
cdef unsigned short CRC_16_POLY = 0x1021
cdef unsigned short CRC_16_FINAL_XOR = 0x0

@cython.boundscheck(False)
@cython.wraparound(False)
cpdef unsigned short crc16_canfd_cy(const unsigned char[::1] data):
    """
    Compute CRC-16 for CAN FD frame.
    """

    cdef Py_ssize_t idx, size = data.shape[0]
    cdef unsigned short crc = CRC_16_INIT
    cdef unsigned char byte
    cdef int bit

    for idx in range(size):
        byte = data[idx]
        crc ^= (<unsigned short>byte) << 8
        for bit in range(8):
            if crc & 0x8000:
                crc = <unsigned short>((crc << 1) ^ CRC_16_POLY)
            else:
                crc = <unsigned short>(crc << 1)
    return crc ^ CRC_16_FINAL_XOR
