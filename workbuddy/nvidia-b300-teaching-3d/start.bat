@echo off
chcp 65001 >nul
title NVIDIA DGX B300 教学演示 · 启动
cd /d "%~dp0"

echo.
echo   NVIDIA DGX B300 (Blackwell Ultra) · 交互教学演示
echo   -------------------------------------------------------
echo   方式一：直接双击本目录的 index.html（零依赖、无需联网）
echo   方式二：本脚本启动本地 HTTP 服务，地址见下方
echo.
echo   课堂操作：播放/暂停 · 拆解滑块 · 旋转速度 · 透视外壳
echo             四种演示模式 · 点击部件看说明 · 重置全部
echo.

where python >nul 2>nul
if %errorlevel%==0 (
  start "B300 HTTP Server" /min cmd /c "python -m http.server 8000 --bind 127.0.0.1"
  timeout /t 2 /nobreak >nul
  echo   本地地址: http://127.0.0.1:8000/index.html
  start "" "http://127.0.0.1:8000/index.html"
) else (
  echo   未检测到 Python，改用本地文件方式打开。
  start "" "index.html"
)
echo.
echo   页面已打开。关闭标题为 "B300 HTTP Server" 的窗口即可停止服务。
echo   按任意键关闭本提示窗口。
pause >nul
