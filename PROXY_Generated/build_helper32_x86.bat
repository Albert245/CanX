@echo off
call "C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars32.bat"

cl /nologo /MT /O2 /FeHelper32.exe Helper32.cpp

echo Build OK
pause
