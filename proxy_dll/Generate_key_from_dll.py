# r"""test.dll"""
 
import ctypes
import subprocess
import time
import os
from logger.log import logger
 
# # Load the 64-bit Proxy DLL
# proxy_dll = ctypes.WinDLL(r"D:\COMMON\USERS\NhatPM7\Tool\CAN\proxy_dll\ProxyDLL.dll")
 
# # Define function prototype
# proxy_dll.Call32BitASKKeyGenerate.argtypes = [
#     ctypes.c_char_p,  # DLL Path (String)
#     ctypes.POINTER(ctypes.c_ubyte),  # Seed (Pointer to Byte Array)
#     ctypes.POINTER(ctypes.c_ubyte)   # Key Buffer (Pointer to Byte Array)
# ]
# proxy_dll.Call32BitASKKeyGenerate.restype = ctypes.c_int  # Return an integer (Success/Failure)
 
def ASK_KeyGenerate(dll_path, seed):
    """ Generate key from given seed """
    result = None
   
    # Convert seed to hex string
    seed_hex = f"{seed:016X}"
    # print("Generating key")
    cwd = os.getcwd()
    helper_path = cwd + r'\GenerateKey.exe'
 
    # Call Helper32.exe
    result = subprocess.run([helper_path, dll_path, seed_hex], capture_output=True, text=True)
 
    if result.returncode != 0:
        logger.error(f"Error calling Helper32.exe: {result.stderr}")
        return None
 
    # Get the computed key
    computed_key = result.stdout.strip()
    # print(computed_key)
    return computed_key
 
if __name__ == "__main__":
    # Example Usage
    dll_path = r"test.dll"
    seed = 0x750d4c7799b585a6  # Example 64-bit seed
    logger.info(f'seed : {seed}')
    computed_key = ASK_KeyGenerate(dll_path, seed)
    if computed_key:
        logger.info(f"Generated Key : {computed_key}")