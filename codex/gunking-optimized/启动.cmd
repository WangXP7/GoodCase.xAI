@echo off
chcp 65001 >nul
cd /d "%~dp0"
node tools\build.mjs
if errorlevel 1 goto fail
node tools\serve.mjs --open
if errorlevel 1 goto fail
exit /b
:fail
echo 启动失败。请确认本机已安装 Node.js，并查看上方错误。
pause
