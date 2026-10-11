@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 没有找到 Node.js，请先安装 Node 18 或更高版本。
  pause
  exit /b 1
)

echo 正在启动活动工作台...
echo 将检查当前后端版本与账号接口，必要时自动重启旧服务。
echo.
echo 停止服务：在本窗口按 Ctrl+C，或运行 stop.bat
echo.

node "workbench\demo2\tools\start-local.mjs"
if not errorlevel 1 exit /b 0

echo.
echo [服务已退出] 如果上方出现 EADDRINUSE，说明端口 4175 被占用，请先运行 stop.bat。
pause
