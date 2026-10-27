@echo off
rem Arknights Simulator - double-click to start (Windows), port 3100.
rem A thin wrapper around scripts\start-windows.bat that only pins the port, so this copy can run
rem next to a stock "Stronghold Protocol" install (port 3000) without sharing localStorage, the
rem Service Worker or the asset cache. Override it with:  start  --port 3200
rem Keep this file ASCII-only: non-ASCII text here makes cmd re-read the script at the wrong offset.
chcp 65001 >nul
setlocal EnableExtensions
rem Sandbox, not the game: skip the content-hash asset index (SP_ASSET_INDEX=0). It walks and
rem SHA-256s public/assets + public/fonts (31k files here) shortly after every start, only to
rem cache-bust URLs for players over the internet. Single-player local sandbox: no need at all.
set "SP_ASSET_INDEX=0"
rem ---- Debug logging entry ----
rem Uncomment the next line to print browser interaction logs in this window:
rem every click, tab/page switch, music handover and module boot time is echoed here.
rem Same effect without editing this file: pass --debug on the command line.
rem Browser-side override for one machine: localStorage.setItem('arksim-debug','1') / '0'
rem set "SI_DEBUG=1"
title ARK/SIM - Arknights Simulator
cd /d "%~dp0"
call "%~dp0scripts\start-windows.bat" --port 3100 %*
exit /b %errorlevel%
