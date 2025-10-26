import ctypes
import sys
import pefile
import time
"""
ASK_KeyGenerate
GenerateKeyEx
seed2key
vGetVersionInfo
"""
 
start = time.time()
# Load 32-bit DLL
dll_path = r"D:\00_Src\AUTOSAR_BJ_EV\CryptoLib\ASK\20_lib_Win32_client\HKMC_AdvancedSeedKey_Win32.dll"
# dll_path = r"a.dll"
security_dll = ctypes.WinDLL(dll_path)  # Use WinDLL or CDLL depending on the DLL type
pe = pefile.PE(dll_path)
 
print("Exported Functions:")
for exp in pe.DIRECTORY_ENTRY_EXPORT.symbols:
    print(exp.name.decode() if exp.name else f"Ordinal {exp.ordinal}")
 
# Allocate a buffer (assuming version info is max 256 bytes)
version_buffer = ctypes.create_string_buffer(256)
 
# Modify the function prototype to accept an output buffer
security_dll.vGetVersionInfo.argtypes = [ctypes.POINTER(ctypes.c_char)]
security_dll.vGetVersionInfo.restype = None  # Function modifies buffer, so no return value
 
# Call the function
security_dll.vGetVersionInfo(version_buffer)
 
# Convert buffer to string
print(f"DLL Version: {version_buffer.value.decode('utf-8')}")
 
# Assume seed2key takes a byte array and returns a byte array
security_dll.seed2key.argtypes = [ctypes.POINTER(ctypes.c_ubyte), ctypes.POINTER(ctypes.c_ubyte)]
security_dll.seed2key.restype = None  # If it modifies an output buffer
 
# Assume seed2key takes a byte array and returns a byte array
security_dll.ASK_KeyGenerate.argtypes = [ctypes.POINTER(ctypes.c_ubyte), ctypes.POINTER(ctypes.c_ubyte)]
security_dll.ASK_KeyGenerate.restype = None  # If it modifies an output buffer
 
security_dll.GenerateKeyEx.argtypes = [ctypes.POINTER(ctypes.c_ubyte), ctypes.POINTER(ctypes.c_ubyte)]
security_dll.GenerateKeyEx.restype = None  # If it modifies an output buffer
 
# Prepare seed input (2-byte seed)
seed = (0x75, 0x0d,0x4c,0x77,0x99,0xb5,0x85,0xa6)
seed1 = (0x750d4c7799b585a6)
seed2 = (0x42ad3f73470ddf4b)
print(seed1)
# print(len(seed1))
seed_buffer = (ctypes.c_ubyte * len(seed))(*seed)
 
# Prepare output buffer (assuming key is 2 bytes)
 
key_buffer = (ctypes.c_ubyte * 8)()
key_buffer1 = (ctypes.c_ubyte * 256)()
key_buffer2 = (ctypes.c_ubyte * 256)()
 
seed_bytes = seed1.to_bytes(8, byteorder='big')  # Converts to 8-byte array
seed_bytes2 = seed2.to_bytes(8, byteorder='big')  # Converts to 8-byte array
 
# Create a ctypes c_ubyte array (8 bytes)
seed_array = (ctypes.c_ubyte * 8)(*seed_bytes)
seed_array2 = (ctypes.c_ubyte * 8)(*seed_bytes2)
 
# Create an LP_c_ubyte pointer (Pointer to seed_array)
LP_c_ubyte = ctypes.POINTER(ctypes.c_ubyte)  # Define pointer type
seed_ptr = ctypes.cast(seed_array, LP_c_ubyte)
seed_ptr2 = ctypes.cast(seed_array2, LP_c_ubyte)
 
 
# Call function
 
security_dll.ASK_KeyGenerate(seed_buffer, key_buffer)
# Convert key to string
computed_key = " ".join(f"{b:02X}" for b in key_buffer)
print(f"Computed Key: {computed_key}")
 
# security_dll.ASK_KeyGenerate(seed_ptr2, key_buffer1)
# # Convert key to string
# computed_key1 = " ".join(f"{b:02X}" for b in key_buffer1)
# print(f"Computed Key: {computed_key1}")
 
 
# # Convert arg1 and arg2 into `ctypes.c_ubyte` arrays
# arg1 = (ctypes.c_ubyte * 1)(10)  # Single-byte array
# arg2 = (ctypes.c_ubyte * 1)(8)  # Single-byte array
 
# # Convert to pointers
# arg1_ptr = ctypes.cast(arg1, ctypes.POINTER(ctypes.c_ubyte))
# arg2_ptr = ctypes.cast(arg2, ctypes.POINTER(ctypes.c_ubyte))
 
# security_dll.GenerateKeyEx(arg1_ptr, seed_ptr2, arg2_ptr, key_buffer2,256)
# # Convert key to string
# computed_key2 = " ".join(f"{b:02X}" for b in key_buffer2)
# print(f"Computed Key2: {computed_key2}")
 
# print(time.time()-start)