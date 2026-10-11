@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo 正在停止活动工作台（端口 4175）...
echo.

powershell -NoProfile -Command "$demoPort = if ($env:DEMO2_PORT) { [int]$env:DEMO2_PORT } else { 4175 }; $listeners = @(Get-NetTCPConnection -State Listen -LocalPort $demoPort -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); foreach ($listenerId in $listeners) { $info = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $listenerId); if ($info.Name -ne 'node.exe' -or $info.CommandLine -notmatch 'demo2[\\/]server\.mjs') { Write-Host 'Skipped unrelated application'; continue }; $parentInfo = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $info.ParentProcessId); if ($parentInfo.Name -eq 'node.exe' -and $parentInfo.CommandLine -match 'demo2[\\/]server\.mjs' -and $parentInfo.CommandLine -match '--watch') { Stop-Process -Id $parentInfo.ProcessId -ErrorAction SilentlyContinue }; Stop-Process -Id $listenerId -ErrorAction SilentlyContinue; Write-Host ('Stopped Demo2 PID ' + $listenerId) }"

echo.
echo 完成。如果端口本来就没有服务在运行，则不会执行任何操作。
timeout /t 3 >nul
