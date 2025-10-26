#include <windows.h>
#include <iostream>
 
typedef void (__stdcall *ASK_KeyGenerate_FUNC)(unsigned char*, unsigned char*);
 
int main(int argc, char* argv[]) {
    if (argc != 3) {
        std::cerr << "Usage: Helper32.exe <dll_path> <seed_hex>" << std::endl;
        return -1;
    }
 
    const char* dllPath = argv[1];
 
    // Convert seed from hex string to bytes
    unsigned char seed[8];
    sscanf(argv[2], "%02hhX%02hhX%02hhX%02hhX%02hhX%02hhX%02hhX%02hhX",
           &seed[0], &seed[1], &seed[2], &seed[3], &seed[4], &seed[5], &seed[6], &seed[7]);
 
    // Load the 32-bit DLL dynamically
    HMODULE hLib = LoadLibraryA(dllPath);
    if (!hLib) {
        std::cerr << "Error: Failed to load 32-bit DLL. GetLastError() = " << GetLastError() << std::endl;
        return -1;
    }
 
    // Get the address of the function
    ASK_KeyGenerate_FUNC ASK_KeyGenerate = (ASK_KeyGenerate_FUNC)GetProcAddress(hLib, "ASK_KeyGenerate");
    if (!ASK_KeyGenerate) {
        std::cerr << "Error: Failed to find function 'ASK_KeyGenerate'. GetLastError() = " << GetLastError() << std::endl;
        FreeLibrary(hLib);
        return -2;
    }
 
    // Prepare the output buffer
    unsigned char keyBuffer[8] = {0};
 
    // Call the function
    ASK_KeyGenerate(seed, keyBuffer);
 
    // Print the computed key (so Python can read it)
    for (int i = 0; i < 8; i++) {
        printf("%02X", keyBuffer[i]);
    }
    printf("\n");
 
    // Free the DLL
    FreeLibrary(hLib);
    return 0;
}
 