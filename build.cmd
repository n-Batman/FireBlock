@echo off
setlocal
cd /d "%~dp0"
set "FIREBLOCK_VS="
for /f "usebackq tokens=*" %%i in (`"%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe" -latest -products * -property installationPath`) do set "FIREBLOCK_VS=%%i"
if not defined FIREBLOCK_VS (
  echo Install Visual Studio Build Tools with Desktop development with C++.
  exit /b 1
)
set "FIREBLOCK_ARCH=x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "FIREBLOCK_ARCH=arm64"
call "%FIREBLOCK_VS%\VC\Auxiliary\Build\vcvarsall.bat" %FIREBLOCK_ARCH%
if errorlevel 1 exit /b 1
cmake -S . -B build/native -G "NMake Makefiles" -DCMAKE_BUILD_TYPE=Release
if errorlevel 1 exit /b 1
cmake --build build/native
if errorlevel 1 exit /b 1
ctest --test-dir build/native --output-on-failure
if errorlevel 1 exit /b 1
echo Ready: build\native\fireblock.exe
