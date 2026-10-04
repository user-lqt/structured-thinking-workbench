@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

set "URL=http://127.0.0.1:4175/"

netstat -ano | findstr /C:"LISTENING" | findstr /C:"127.0.0.1:4175" >nul
if not errorlevel 1 (
  echo 服务已经在运行，直接打开浏览器。
  echo 需要停止请运行 stop.bat
  start "" "%URL%"
  timeout /t 4 >nul
  exit /b 0
)

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先安装 Node 18 或更高版本。
  pause
  exit /b 1
)

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:4175/'"

echo 正在启动活动工作台...
echo 地址：%URL%
echo.
echo 停止服务：在本窗口按 Ctrl+C，或运行 stop.bat
echo.

node "workbench\demo2\server.mjs"

echo.
echo [服务已退出] 如果上方出现 EADDRINUSE，说明端口 4175 被占用，请先运行 stop.bat。
pause
