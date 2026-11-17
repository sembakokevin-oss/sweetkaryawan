@echo off
setlocal
rem Menghentikan server SWEET yang berjalan di port (default 8080). Pemakaian: stop.bat [port]
set PORT=%1
if "%PORT%"=="" set PORT=8080
set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /r /c:":%PORT% .*LISTENING"') do (
  echo Menghentikan proses PID %%a pada port %PORT%...
  taskkill /PID %%a /F >nul 2>&1
  set FOUND=1
)
if "%FOUND%"=="0" echo Tidak ada server yang berjalan di port %PORT%.
endlocal
