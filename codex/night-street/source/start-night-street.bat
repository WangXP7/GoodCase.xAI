@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-night-street.ps1"
if errorlevel 1 pause
endlocal
