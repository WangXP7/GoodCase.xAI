@echo off
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Opening the offline cockpit instead.
  start "" "%~dp0index.html"
  exit /b 0
)
node "%~dp0tools\start-preview.cjs"
if errorlevel 1 (
  echo Preview could not start. You can still open index.html directly.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:4187/"
