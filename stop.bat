@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 正在停止活动工作台（端口 4175）...
echo.

for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:"LISTENING" ^| findstr /C:"127.0.0.1:4175"') do (
  echo   停止进程 PID %%p
  taskkill /PID %%p /F >nul 2>nul
)

echo.
echo 完成。如果端口本来就没有服务在运行，则不会执行任何操作。
timeout /t 3 >nul
