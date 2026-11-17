@echo off
rem Menjalankan jembatan MetaTrader 5 secara manual (biasanya tidak perlu: server SWEET menyalakannya otomatis).
rem Data login dibaca langsung dari .env oleh mt5_bridge.py.
title SWEET - MT5 bridge
cd /d "%~dp0.."
where python >nul 2>nul && (python scripts\mt5_bridge.py) || (py -3 scripts\mt5_bridge.py)
pause
