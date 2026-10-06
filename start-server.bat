@echo off
rem Island local server (double-click to start, close this window to stop)
chcp 65001 > nul
cd /d "%~dp0"
node server.mjs
pause
