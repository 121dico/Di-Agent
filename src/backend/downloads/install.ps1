# AgentHub daemon Windows 安装脚本（由 launcher .bat 调用，参数：-ServerUrl -ApiKey）
# 安装到 %USERPROFILE%\.agenthub，注册开机自启（Startup 文件夹），并立即启动。
param(
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$ApiKey
)

$ErrorActionPreference = 'Stop'
$Dir = Join-Path $env:USERPROFILE '.agenthub'
$NodeVer = '22.14.0'

function Write-Step($msg) { Write-Host "[AgentHub] $msg" -ForegroundColor Cyan }

New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# --- 1. 定位 Node >= 18（系统有则用，没有则下载到用户目录，不需要管理员权限）---
$NodeBin = $null
$cmd = Get-Command node -ErrorAction SilentlyContinue
if ($cmd) {
  $ver = (& node -v) -replace '^v', ''
  $major = [int]($ver.Split('.')[0])
  if ($major -ge 18) { $NodeBin = $cmd.Source }
}
if (-not $NodeBin) {
  Write-Step "未检测到 Node >= 18，下载 Node v$NodeVer（先服务器、后国内镜像）..."
  $zip = Join-Path $env:TEMP "node-win-x64.zip"
  $urls = @(
    "$ServerUrl/downloads/node-v$NodeVer-win-x64.zip",
    "https://registry.npmmirror.com/-/binary/node/v$NodeVer/node-v$NodeVer-win-x64.zip"
  )
  $ok = $false
  foreach ($u in $urls) {
    try { Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing; $ok = $true; break } catch { }
  }
  if (-not $ok) { throw "Node 下载失败，请手动安装 Node 18+ 后重试" }
  Expand-Archive -Path $zip -DestinationPath $Dir -Force
  $NodeBin = Join-Path $Dir "node-v$NodeVer-win-x64\node.exe"
}
Write-Step "Node: $NodeBin"

# --- 2. 下载 daemon 离线包（局域网服务器，无需 npm/外网）---
Write-Step "下载 daemon 离线包..."
$Bundle = Join-Path $env:TEMP 'agenthub-daemon-bundle.tar.gz'
Invoke-WebRequest -Uri "$ServerUrl/downloads/agenthub-daemon-bundle.tar.gz" -OutFile $Bundle -UseBasicParsing
tar -xzf $Bundle -C $Dir
$DaemonJs = Join-Path $Dir 'node_modules\@hust-agenthub\daemon\bin\agenthub-daemon.js'
if (-not (Test-Path $DaemonJs)) { throw "daemon 包解压失败：$DaemonJs 不存在" }

# --- 3. 生成启动脚本（幂等：重跑即更新 key 并重启）---
$StartCmd = Join-Path $Dir 'start-daemon.cmd'
@"
@echo off
"$NodeBin" "$DaemonJs" --server-url $ServerUrl --api-key $ApiKey
"@ | Set-Content -Path $StartCmd -Encoding ASCII

# --- 4. 注册开机自启（当前用户 Startup 文件夹，无需管理员）---
$Startup = [Environment]::GetFolderPath('Startup')
$AutoCmd = Join-Path $Startup 'agenthub-daemon.cmd'
@"
@echo off
start "" /min cmd /c "$StartCmd"
"@ | Set-Content -Path $AutoCmd -Encoding ASCII

# --- 5. 立即启动（先杀旧进程，保证重跑时干净重启）---
Write-Step "启动 daemon..."
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -like '*agenthub-daemon.js*' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Process -WindowStyle Hidden cmd -ArgumentList '/c', $StartCmd

Write-Host ""
Write-Host "[AgentHub] 安装完成！daemon 已在后台运行并注册开机自启。" -ForegroundColor Green
Write-Host "[AgentHub] 日志目录：$Dir\daemon.log（start-daemon.cmd 同目录执行可看输出）"
Write-Host "[AgentHub] 现在回到浏览器，电脑状态将自动变为 Connected。"
