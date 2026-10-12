import { statSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const port = Number(process.env.DEMO2_PORT || 4175);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid DEMO2_PORT.');
const base = `http://127.0.0.1:${port}/`;
const noBrowser = process.argv.includes('--no-browser');
const backendFiles = ['server.mjs', 'server/personnel.mjs', 'server/shared.mjs', 'core/deliveries.js', 'core/task-lifecycle.js', 'core/signup.js'];
const latestWrite = Math.max(...backendFiles.map((file) => statSync(path.join(repoRoot, 'workbench/demo2', file)).mtimeMs));
const powershell = (source) => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { encoding: 'utf8', windowsHide: true }).trim();
const isDemo = (info) => info?.Name === 'node.exe' && /demo2[\\/]server\.mjs/.test(info.CommandLine || '');
const openBrowser = () => { if (!noBrowser) spawn('cmd.exe', ['/c', 'start', '', base], { windowsHide: true, stdio: 'ignore' }).unref(); };
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function ready() {
  try { const response = await fetch(`${base}api/personnel/me`, { signal: AbortSignal.timeout(1500) }); return response.status === 401 || response.ok; }
  catch { return false; }
}

const raw = powershell(`$listeners = @(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); $rows = @($listeners | ForEach-Object { $info = Get-CimInstance Win32_Process -Filter "ProcessId = $_"; [pscustomobject]@{ ProcessId = $info.ProcessId; ParentProcessId = $info.ParentProcessId; Name = $info.Name; CommandLine = $info.CommandLine; Started = ($info.CreationDate.ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds } }); ConvertTo-Json -InputObject $rows -Compress`);
const processes = raw ? JSON.parse(raw) : [];
if (processes.some((info) => !isDemo(info))) throw new Error(`Port ${port} belongs to another application; no process was stopped.`);
if (processes.length && processes.every((info) => info.Started >= latestWrite) && await ready()) {
  console.log(`Campus Activity Workbench v1.0 is already running: ${base}`); openBrowser();
} else {
  for (const info of processes) {
    console.log('Restarting outdated Campus Activity Workbench; project and attendance files are preserved.');
    powershell(`$info = Get-CimInstance Win32_Process -Filter 'ProcessId = ${info.ProcessId}'; if (-not ($info.Name -eq 'node.exe' -and $info.CommandLine -match 'demo2[\\/]server\.mjs')) { throw 'Process changed; no process stopped.' }; $parentInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($info.ParentProcessId)"; if ($parentInfo.Name -eq 'node.exe' -and $parentInfo.CommandLine -match 'demo2[\\/]server\.mjs' -and $parentInfo.CommandLine -match '--watch') { Stop-Process -Id $parentInfo.ProcessId -ErrorAction SilentlyContinue }; Stop-Process -Id ${info.ProcessId} -ErrorAction SilentlyContinue`);
  }
  const child = spawn(process.execPath, ['--watch', '--watch-preserve-output', 'workbench/demo2/server.mjs'], { cwd: repoRoot, env: process.env, stdio: 'inherit', windowsHide: true });
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code) => { process.exitCode = code || 0; });
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await ready()) { console.log(`Account service is ready: ${base}`); openBrowser(); break; }
    if (child.exitCode !== null) throw new Error('Campus Activity Workbench failed to start.');
    await wait(100);
  }
}
