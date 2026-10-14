@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo  牛来：梦野逐风
echo  本地地址：http://127.0.0.1:4173
echo  请保持此窗口开启，按 Ctrl+C 可停止游戏服务器。
echo.
start "" http://127.0.0.1:4173
node scripts\serve.mjs
