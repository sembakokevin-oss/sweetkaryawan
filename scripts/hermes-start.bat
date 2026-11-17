@echo off
rem Menjalankan Hermes gateway secara manual (biasanya tidak perlu: server SWEET menyalakannya otomatis).
title SWEET - Hermes gateway
for /f "tokens=1,* delims==" %%a in ('findstr /b "HERMES_API_KEY=" "%~dp0..\.env"') do set API_SERVER_KEY=%%b
set API_SERVER_ENABLED=true
set API_SERVER_HOST=127.0.0.1
set API_SERVER_PORT=8642
set WSLENV=API_SERVER_KEY:API_SERVER_ENABLED:API_SERVER_HOST:API_SERVER_PORT
wsl.exe -e bash -lc "export PATH=$HOME/.local/bin:$HOME/.hermes/bin:$PATH; hermes gateway"
pause
