r"""
& C:\Users\vinhnt63\AppData\Local\Programs\Python\Python312-32\python.exe d:/COMMON/USERS/NhatPM7/Tool/CAN/GenerateKey.py
"""
 
 
import ctypes
import sys
import os
from logger.log import logger
 
 
# Check if correct arguments are passed
if len(sys.argv) != 3:
    logger.error("Usage: call_32bit.exe <seed> <dll_path>")
    sys.exit(1)
 
# Read command-line arguments
seed = sys.argv[1]  # seed string
dll_path = sys.argv[2]  # DLL path
 
# Ensure DLL exists
if not os.path.exists(dll_path):
    logger.error(f"Error: DLL not found at {dll_path}")
    sys.exit(1)
 
# Load the DLL
security_dll = ctypes.CDLL(dll_path)
 
# Convert order==========
 
seed_len = int(len(seed)/2)
if (len(seed) % 2) != 0:
    seed_len = int((len(seed)+1)/2)
 
seed_int = int(seed,16)
seed_bytes = seed_int.to_bytes(seed_len, byteorder='big')  # Converts to 8-byte array
 
 
# Create a ctypes c_ubyte array (8 bytes)
seed_array = (ctypes.c_ubyte * seed_len)(*seed_bytes)
key_buffer = (ctypes.c_ubyte * seed_len)()
 
# Create an LP_c_ubyte pointer (Pointer to seed_array)
LP_c_ubyte = ctypes.POINTER(ctypes.c_ubyte)  # Define pointer type
seed_buffer = ctypes.cast(seed_array, LP_c_ubyte)
#========================
 
 
# Define function prototype
security_dll.ASK_KeyGenerate.argtypes = [ctypes.POINTER(ctypes.c_ubyte), ctypes.POINTER(ctypes.c_ubyte)]
security_dll.ASK_KeyGenerate.restype = None  # If it modifies an output buffer
 
# Call the function
security_dll.ASK_KeyGenerate(seed_buffer, key_buffer)
computed_key = " ".join(f"{b:02X}" for b in key_buffer)
 
# Print the key (so Python 64-bit can read it)
logger.info(f"key:{computed_key}")
 