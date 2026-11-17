@echo off
title SWEET AI Agent Office - Mode Pengembangan
cd /d "%~dp0.."
echo Mode pengembangan: server restart otomatis setiap file diubah.
npx nodemon --watch src --ext js src\index.js
