# Di Agent daemon Windows 安装脚本（由 launcher .bat 调用，参数：-ServerUrl -ApiKey）
# 安装到 %USERPROFILE%\.di-agent，注册开机自启（Startup 文件夹），并立即启动。
param(
  [Parameter(Mandatory = $true)][string]$ServerUrl,
  [Parameter(Mandatory = $true)][string]$ApiKey
)

$ErrorActionPreference = 'Stop'
$Dir = if ($env:DI_AGENT_INSTALL_DIR) { $env:DI_AGENT_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.di-agent' }
$LegacyDir = if ($env:DI_AGENT_LEGACY_INSTALL_DIR) { $env:DI_AGENT_LEGACY_INSTALL_DIR } else { Join-Path $env:USERPROFILE '.agenthub' } # [brand-compat]
$NodeVer = '22.14.0'
$Startup = if ($env:DI_AGENT_STARTUP_DIR) { $env:DI_AGENT_STARTUP_DIR } else { [Environment]::GetFolderPath('Startup') }
$AutoCmd = Join-Path $Startup 'di-agent-daemon.cmd'
$LegacyAutoCmd = Join-Path $Startup 'agenthub-daemon.cmd' # [brand-compat]
$MigratedLegacyHome = $false
$LegacyProcessStopped = $false
$InstallCommitted = $false
$StdoutLogBackup = $null
$LegacyStartupBackup = $null
$LegacyHomeBackup = $null

function Write-Step($msg) { Write-Host "[Di Agent] $msg" -ForegroundColor Cyan }

try {
  if (-not (Test-Path $Dir) -and (Test-Path $LegacyDir -PathType Container)) {
    Copy-Item -Path $LegacyDir -Destination $Dir -Recurse
    $MigratedLegacyHome = $true
    Write-Step "已复制已有 daemon 状态到 $Dir，连接成功后再归档旧目录"
  }
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
    $zip = Join-Path $env:TEMP 'di-agent-node-win-x64.zip'
    $urls = @(
      "$ServerUrl/downloads/node-v$NodeVer-win-x64.zip",
      "https://registry.npmmirror.com/-/binary/node/v$NodeVer/node-v$NodeVer-win-x64.zip"
    )
    $ok = $false
    foreach ($u in $urls) {
      try { Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing; $ok = $true; break } catch { }
    }
    if (-not $ok) { throw 'Node 下载失败，请手动安装 Node 18+ 后重试' }
    Expand-Archive -Path $zip -DestinationPath $Dir -Force
    $NodeBin = Join-Path $Dir "node-v$NodeVer-win-x64\node.exe"
  }
  Write-Step "Node: $NodeBin"

  # --- 2. 下载 daemon 离线包（局域网服务器，无需 npm/外网）---
  Write-Step '下载 daemon 离线包...'
  $Bundle = Join-Path $env:TEMP 'di-agent-daemon-bundle.tar.gz'
  Invoke-WebRequest -Uri "$ServerUrl/downloads/di-agent-daemon-bundle.tar.gz" -OutFile $Bundle -UseBasicParsing
  tar -xzf $Bundle -C $Dir
  $DaemonJs = Join-Path $Dir 'node_modules\di-agent-daemon\bin\di-agent-daemon.js'
  if (-not (Test-Path $DaemonJs)) { throw "daemon 包解压失败：$DaemonJs 不存在" }

  # --- 3. 生成启动脚本（幂等：重跑即更新 key 并重启）---
  $StartCmd = Join-Path $Dir 'start-daemon.cmd'
  $StdoutLog = Join-Path $Dir 'daemon.log'
  $StderrLog = Join-Path $Dir 'daemon.err.log'
  if (Test-Path $StdoutLog) {
    $BackupDir = Join-Path $Dir 'compat-backup'
    New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
    $StdoutLogBackup = Join-Path $BackupDir 'previous-daemon.log'
    Move-Item -Path $StdoutLog -Destination $StdoutLogBackup -Force
  }
  @"
@echo off
"$NodeBin" "$DaemonJs" --server-url $ServerUrl --api-key $ApiKey >> "$StdoutLog" 2>> "$StderrLog"
"@ | Set-Content -Path $StartCmd -Encoding ASCII

  # --- 4. 注册开机自启并启动 canonical daemon ---
  New-Item -ItemType Directory -Force -Path $Startup | Out-Null
  @"
@echo off
start "" /min cmd /c "$StartCmd"
"@ | Set-Content -Path $AutoCmd -Encoding ASCII

  Write-Step '启动 daemon...'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*di-agent-daemon.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Process -WindowStyle Hidden cmd -ArgumentList '/c', $StartCmd

  if ($env:DI_AGENT_SKIP_HEALTH_CHECK -ne '1') {
    $healthy = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      if ((Test-Path $StdoutLog) -and (Select-String -Path $StdoutLog -SimpleMatch 'stage=daemon.ready' -Quiet)) {
        $healthy = $true
        break
      }
      Start-Sleep -Seconds 1
    }
    if (-not $healthy) { throw 'daemon 未能在 30 秒内连接服务器' }
  }

  # 新 daemon 健康后才停止旧进程并归档旧入口/目录。
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -like '*agenthub-daemon.js*' } | # [brand-compat]
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $LegacyProcessStopped = $true }

  $BackupDir = Join-Path $Dir 'compat-backup'
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  $LegacyPackage = Join-Path $Dir 'node_modules\@hust-agenthub\daemon' # [brand-compat]
  if (Test-Path $LegacyPackage) {
    Move-Item -Path $LegacyPackage -Destination (Join-Path $BackupDir 'previous-daemon-package') -Force
  }
  $LegacyBin = Join-Path $Dir 'node_modules\.bin\agenthub-daemon' # [brand-compat]
  if (Test-Path $LegacyBin) {
    Move-Item -Path $LegacyBin -Destination (Join-Path $BackupDir 'previous-daemon-bin') -Force
  }
  if (Test-Path $LegacyAutoCmd) {
    $LegacyStartupBackup = Join-Path $BackupDir 'startup.cmd'
    Move-Item -Path $LegacyAutoCmd -Destination $LegacyStartupBackup -Force
  }
  if ($MigratedLegacyHome -and (Test-Path $LegacyDir -PathType Container)) {
    $LegacyHomeBackup = Join-Path $BackupDir 'previous-home'
    Move-Item -Path $LegacyDir -Destination $LegacyHomeBackup
  }

  $InstallCommitted = $true
  Write-Host ''
  Write-Host '[Di Agent] 安装完成！daemon 已在后台运行并注册开机自启。' -ForegroundColor Green
  Write-Host "[Di Agent] 日志目录：$Dir\daemon.log"
  Write-Host '[Di Agent] 现在回到浏览器，电脑状态将自动变为 Connected。'
} catch {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*di-agent-daemon.js*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  if (-not $InstallCommitted -and $LegacyHomeBackup -and (Test-Path $LegacyHomeBackup) -and -not (Test-Path $LegacyDir)) {
    Move-Item -Path $LegacyHomeBackup -Destination $LegacyDir
  }
  if (-not $InstallCommitted -and $LegacyStartupBackup -and (Test-Path $LegacyStartupBackup) -and -not (Test-Path $LegacyAutoCmd)) {
    Move-Item -Path $LegacyStartupBackup -Destination $LegacyAutoCmd
  }
  if (-not $InstallCommitted -and $MigratedLegacyHome -and (Test-Path $LegacyDir) -and (Test-Path $Dir)) {
    Remove-Item -Path $Dir -Recurse -Force
  } elseif (-not $InstallCommitted -and $StdoutLogBackup -and (Test-Path $StdoutLogBackup)) {
    Remove-Item -Path $StdoutLog -Force -ErrorAction SilentlyContinue
    Move-Item -Path $StdoutLogBackup -Destination $StdoutLog -Force
  }
  if ($LegacyProcessStopped -and (Test-Path $LegacyAutoCmd)) {
    Start-Process -WindowStyle Hidden cmd -ArgumentList '/c', $LegacyAutoCmd
  }
  throw
}
