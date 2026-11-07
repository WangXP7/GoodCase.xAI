@echo off
chcp 65001 >nul
title 四冲程发动机教学演示 · 本地服务
cd /d "%~dp0"

echo.
echo   四冲程直列四缸发动机 · 交互教学演示
echo   --------------------------------------------
echo   本地地址: http://127.0.0.1:8000/index.html
echo   (也可以直接双击 index.html，无需联网)
echo   关闭下面弹出的服务窗口即可停止服务。
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  start "EngineDemo HTTP Server" /min cmd /c "python -m http.server 8000 --bind 127.0.0.1"
  timeout /t 2 /nobreak >nul
  start "" "http://127.0.0.1:8000/index.html"
) else (
  echo   未检测到 Python，改用本地文件方式打开。
  start "" "index.html"
)
echo.
echo   页面已打开，按任意键关闭此提示窗口。
pause >nul
