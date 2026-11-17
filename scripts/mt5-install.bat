@echo off
rem Memasang paket Python "MetaTrader5" untuk agent trading Aurel (XAUUSD) di akun HFM.
title SWEET - Pasang MetaTrader 5 bridge
cd /d "%~dp0.."
echo.
echo  === SWEET: pasang jembatan MetaTrader 5 ===
echo.
where python >nul 2>nul
if errorlevel 1 (
  where py >nul 2>nul
  if errorlevel 1 (
    echo  Python belum terpasang. Pasang Python 3 64-bit dari https://www.python.org/downloads/
    echo  Saat instalasi, centang "Add python.exe to PATH". Lalu jalankan file ini lagi.
    start "" "https://www.python.org/downloads/windows/"
    pause
    exit /b 1
  )
  set PY=py -3
) else (
  set PY=python
)
%PY% -m pip install --upgrade MetaTrader5
if errorlevel 1 (
  echo  Gagal memasang paket MetaTrader5. Pastikan Python 64-bit dan internet aktif.
  pause
  exit /b 1
)
echo.
echo  Paket MetaTrader5 terpasang.
echo.
echo  Langkah berikutnya:
echo   1. Pasang terminal MetaTrader 5 HFM (download dari website HFM, menu Platform - MT5).
echo   2. Buka sekali, login akun 223136467 server HFMarketsGlobal-Live18, centang "Save password".
echo   3. Di MT5: Tools - Options - Expert Advisors - centang "Allow algorithmic trading".
echo   4. Jalankan scripts\start.bat. Server SWEET menyalakan bridge otomatis.
echo      Bila terminal tidak ditemukan, isi MT5_PATH di .env, mis.
echo      MT5_PATH=C:\Program Files\HFM Metatrader 5\terminal64.exe
echo.
pause
