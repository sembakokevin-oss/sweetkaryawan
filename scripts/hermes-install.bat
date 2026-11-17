@echo off
title SWEET - Pasang Hermes Agent
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0hermes-install.ps1" %*
echo.
pause
