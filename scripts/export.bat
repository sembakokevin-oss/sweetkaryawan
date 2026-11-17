@echo off
cd /d "%~dp0.."
set DAYS=%1
if "%DAYS%"=="" set DAYS=30
node scripts\export.js %DAYS%
echo.
explorer exports
pause
