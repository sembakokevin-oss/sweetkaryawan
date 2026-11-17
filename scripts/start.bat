@echo off
setlocal
title SWEET AI Agent Office - Server
cd /d "%~dp0.."
if not exist node_modules (
  echo [!] Dependensi belum terpasang. Menjalankan setup...
  call "%~dp0setup.bat"
)
if not exist logs mkdir logs
:loop
echo.
echo [%date% %time%] Menjalankan SWEET AI Agent Office...  (Ctrl+C untuk berhenti)
node src\index.js
set CODE=%ERRORLEVEL%
if "%CODE%"=="0" goto end
echo [%date% %time%] Server berhenti (kode %CODE%). Restart otomatis dalam 5 detik... >> logs\restart.log
echo [!] Server berhenti (kode %CODE%). Restart otomatis dalam 5 detik...
timeout /t 5 /nobreak >nul
goto loop
:end
echo Server dihentikan.
endlocal
