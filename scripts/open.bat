@echo off
rem Membuka halaman SWEET di browser. Pemakaian: open.bat [office|dashboard|ruangan|beranda]
set PORT=8080
for /f "tokens=1,2 delims==" %%a in ('findstr /b "PORT=" "%~dp0..\.env" 2^>nul') do set PORT=%%b
set PAGE=%1
if "%PAGE%"=="" set PAGE=dashboard
if /i "%PAGE%"=="beranda" set PAGE=
start "" "http://localhost:%PORT%/%PAGE%"
