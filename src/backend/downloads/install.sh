#!/bin/bash
# Di Agent daemon macOS 安装脚本（由 curl|bash 调用）
# 用法: curl -fsSL http://<server>:8080/downloads/install.sh | bash -s -- --server-url URL --api-key KEY
# 行为: 定位/下载 Node >= 18 → 从服务器局域网下载 daemon 离线包 → 注册用户级
# launchd 开机自启（无需管理员）→ 立即启动。幂等: 重跑只更新 Key 并重启。

set -u

SERVER_URL=""
API_KEY=""
NODE_VER=22.14.0
while [ $# -gt 0 ]; do
  case "$1" in
    --server-url) SERVER_URL="${2:-}"; shift 2 ;;
    --api-key)    API_KEY="${2:-}"; shift 2 ;;
    *) shift ;;
  esac
done

say() { printf '\033[36m[Di Agent]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[Di Agent] 安装失败: %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$SERVER_URL" ] && [ -n "$API_KEY" ] || fail "缺少 --server-url 或 --api-key 参数"

DIR="${DI_AGENT_INSTALL_DIR:-$HOME/.di-agent}"
PLIST="${DI_AGENT_LAUNCH_AGENT_PLIST:-$HOME/Library/LaunchAgents/com.diagent.daemon.plist}"
LEGACY_DIR="${DI_AGENT_LEGACY_INSTALL_DIR:-$HOME/.agenthub}" # [brand-compat] 旧安装位置只用于迁移。
LEGACY_PLIST="${DI_AGENT_LEGACY_LAUNCH_AGENT_PLIST:-$HOME/Library/LaunchAgents/com.agenthub.daemon.plist}" # [brand-compat]
MIGRATED_LEGACY_HOME=0
LEGACY_SERVICE_UNLOADED=0
INSTALL_COMMITTED=0
CANONICAL_SERVICE_LOADED=0
PLIST_BACKUP=""
DAEMON_LOG_BACKUP=""
START_SCRIPT_BACKUP=""
LEGACY_PLIST_BACKUP=""
LEGACY_PACKAGE_BACKUP=""
LEGACY_BIN_BACKUP=""

rollback_install() {
  [ "$INSTALL_COMMITTED" -eq 0 ] || return 0
  if [ "$CANONICAL_SERVICE_LOADED" -eq 1 ]; then
    launchctl unload "$PLIST" >/dev/null 2>&1 || true
  fi
  if [ -f "$PLIST" ]; then
    find "$PLIST" -delete >/dev/null 2>&1 || true
  fi
  if [ -n "$PLIST_BACKUP" ] && [ -f "$PLIST_BACKUP" ]; then
    mv "$PLIST_BACKUP" "$PLIST" >/dev/null 2>&1 || true
    launchctl load "$PLIST" >/dev/null 2>&1 || true
  fi
  if [ -n "$DAEMON_LOG_BACKUP" ] && [ -f "$DAEMON_LOG_BACKUP" ]; then
    if [ -f "$DIR/daemon.log" ]; then
      find "$DIR/daemon.log" -delete >/dev/null 2>&1 || true
    fi
    mv "$DAEMON_LOG_BACKUP" "$DIR/daemon.log" >/dev/null 2>&1 || true
  fi
  if [ -n "$START_SCRIPT_BACKUP" ] && [ -f "$START_SCRIPT_BACKUP" ]; then
    if [ -f "$DIR/start-daemon.sh" ]; then
      find "$DIR/start-daemon.sh" -delete >/dev/null 2>&1 || true
    fi
    mv "$START_SCRIPT_BACKUP" "$DIR/start-daemon.sh" >/dev/null 2>&1 || true
  fi
  if [ -n "$LEGACY_PACKAGE_BACKUP" ] && { [ -e "$LEGACY_PACKAGE_BACKUP" ] || [ -L "$LEGACY_PACKAGE_BACKUP" ]; }; then
    mkdir -p "$DIR/node_modules/@hust-agenthub" >/dev/null 2>&1 || true # [brand-compat]
    mv "$LEGACY_PACKAGE_BACKUP" "$DIR/node_modules/@hust-agenthub/daemon" >/dev/null 2>&1 || true # [brand-compat]
  fi
  if [ -n "$LEGACY_BIN_BACKUP" ] && { [ -e "$LEGACY_BIN_BACKUP" ] || [ -L "$LEGACY_BIN_BACKUP" ]; }; then
    mkdir -p "$DIR/node_modules/.bin" >/dev/null 2>&1 || true
    mv "$LEGACY_BIN_BACKUP" "$DIR/node_modules/.bin/agenthub-daemon" >/dev/null 2>&1 || true # [brand-compat]
  fi
  if [ -n "$LEGACY_PLIST_BACKUP" ] && [ -f "$LEGACY_PLIST_BACKUP" ]; then
    mkdir -p "$(dirname "$LEGACY_PLIST")" >/dev/null 2>&1 || true
    mv "$LEGACY_PLIST_BACKUP" "$LEGACY_PLIST" >/dev/null 2>&1 || true
  fi
  if [ "$LEGACY_SERVICE_UNLOADED" -eq 1 ] && [ -f "$LEGACY_PLIST" ]; then
    launchctl load "$LEGACY_PLIST" >/dev/null 2>&1 || true
  fi
  if [ "$MIGRATED_LEGACY_HOME" -eq 1 ] && [ ! -e "$LEGACY_DIR" ] && [ -e "$DIR" ]; then
    mv "$DIR" "$LEGACY_DIR" >/dev/null 2>&1 || true
  fi
}
trap rollback_install EXIT

if [ ! -e "$DIR" ] && [ -d "$LEGACY_DIR" ]; then
  mv "$LEGACY_DIR" "$DIR" || fail "无法迁移已有 daemon 状态目录"
  MIGRATED_LEGACY_HOME=1
  say "已迁移已有 daemon 状态到 $DIR"
fi
mkdir -p "$DIR" || fail "无法创建 $DIR"

# --- 1. 定位 Node >= 18（系统有则直接用；没有则装到用户目录，无需管理员）---
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
  major=$(node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1)
  if [ "${major:-0}" -ge 18 ] 2>/dev/null; then NODE_BIN="$(command -v node)"; fi
fi
if [ -z "$NODE_BIN" ]; then
  say "未检测到 Node >= 18，开始下载 Node v$NODE_VER（先服务器，后国内镜像）..."
  arch=$(uname -m); [ "$arch" = "arm64" ] || arch=x64
  tarball="node-v$NODE_VER-darwin-$arch.tar.gz"
  if ! curl -fsSL "$SERVER_URL/downloads/$tarball" -o "$DIR/$tarball"; then
    curl -fsSL "https://registry.npmmirror.com/-/binary/node/v$NODE_VER/$tarball" -o "$DIR/$tarball" || fail "Node 下载失败"
  fi
  tar xzf "$DIR/$tarball" -C "$DIR" || fail "Node 解压失败"
  NODE_BIN="$DIR/node-v$NODE_VER-darwin-$arch/bin/node"
fi
say "Node 就绪: $NODE_BIN"

# --- 2. daemon 离线包（从服务器局域网下载，不依赖 npm 与外网）---
say "下载 daemon 离线包..."
curl -fsSL "$SERVER_URL/downloads/di-agent-daemon-bundle.tar.gz" -o "$DIR/bundle.tar.gz" || fail "daemon 包下载失败（请确认能访问 ${SERVER_URL}）"
DAEMON_PACKAGE_DIR="$DIR/node_modules/di-agent-daemon"
DAEMON_LINK_BACKUP=""
if [ -L "$DAEMON_PACKAGE_DIR" ]; then
  # 放在同一父目录，确保相对链接移动后仍指向原开发源码。
  DAEMON_LINK_BACKUP="$DAEMON_PACKAGE_DIR.local-dev-link"
  backup_index=1
  while [ -e "$DAEMON_LINK_BACKUP" ] || [ -L "$DAEMON_LINK_BACKUP" ]; do
    DAEMON_LINK_BACKUP="$DAEMON_PACKAGE_DIR.local-dev-link.$backup_index"
    backup_index=$((backup_index + 1))
  done
  mv "$DAEMON_PACKAGE_DIR" "$DAEMON_LINK_BACKUP" || fail "无法备份已有 daemon 开发链接"
  say "已保留原 daemon 开发链接: $DAEMON_LINK_BACKUP"
fi
if ! tar xzf "$DIR/bundle.tar.gz" -C "$DIR"; then
  # 仅在 tar 尚未生成新目标时回滚，避免覆盖部分解压内容。
  if [ -n "$DAEMON_LINK_BACKUP" ] && [ -L "$DAEMON_LINK_BACKUP" ] && \
    [ ! -e "$DAEMON_PACKAGE_DIR" ] && [ ! -L "$DAEMON_PACKAGE_DIR" ]; then
    mv "$DAEMON_LINK_BACKUP" "$DAEMON_PACKAGE_DIR" || fail "daemon 包解压失败，且无法恢复原开发链接"
  fi
  fail "daemon 包解压失败"
fi
DAEMON_JS="$DIR/node_modules/di-agent-daemon/bin/di-agent-daemon.js"
[ -f "$DAEMON_JS" ] || fail "daemon 入口文件缺失"

# --- 3. 启动脚本（幂等: 重跑即更新 Key 并重启）---
# PATH 固化为当前终端的完整 PATH: launchd 拉起进程时默认 PATH 只有 /usr/bin:/bin，
# 不固化的话 daemon 扫不到 claude/codex 等 CLI。
if [ -f "$DIR/start-daemon.sh" ]; then
  mkdir -p "$DIR/compat-backup"
  START_SCRIPT_BACKUP="$DIR/compat-backup/previous-start-daemon.sh"
  backup_index=1
  while [ -e "$START_SCRIPT_BACKUP" ]; do
    START_SCRIPT_BACKUP="$DIR/compat-backup/previous-start-daemon.$backup_index.sh"
    backup_index=$((backup_index + 1))
  done
  mv "$DIR/start-daemon.sh" "$START_SCRIPT_BACKUP" || fail "无法备份现有 daemon 启动脚本"
fi
cat > "$DIR/start-daemon.sh" <<EOF
#!/bin/bash
export PATH="$PATH"
exec "$NODE_BIN" "$DAEMON_JS" --server-url "$SERVER_URL" --api-key "$API_KEY"
EOF
chmod +x "$DIR/start-daemon.sh"

# --- 4. 用户级 launchd 开机自启 + 立即启动（无需管理员密码）---
mkdir -p "$(dirname "$PLIST")"
if [ -f "$PLIST" ]; then
  mkdir -p "$DIR/compat-backup"
  PLIST_BACKUP="$DIR/compat-backup/previous-launch-agent.plist"
  backup_index=1
  while [ -e "$PLIST_BACKUP" ]; do
    PLIST_BACKUP="$DIR/compat-backup/previous-launch-agent.$backup_index.plist"
    backup_index=$((backup_index + 1))
  done
  mv "$PLIST" "$PLIST_BACKUP" || fail "无法备份现有 launchd 配置"
fi
cat > "$PLIST" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.diagent.daemon</string>
  <key>ProgramArguments</key><array><string>$DIR/start-daemon.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/daemon.log</string>
  <key>StandardErrorPath</key><string>$DIR/daemon.err.log</string>
</dict></plist>
EOF2

# 健康检查只能观察本次启动产生的 ready 事件；旧日志先归档，失败时回滚恢复。
if [ -f "$DIR/daemon.log" ]; then
  mkdir -p "$DIR/compat-backup"
  DAEMON_LOG_BACKUP="$DIR/compat-backup/previous-daemon.log"
  backup_index=1
  while [ -e "$DAEMON_LOG_BACKUP" ]; do
    DAEMON_LOG_BACKUP="$DIR/compat-backup/previous-daemon.$backup_index.log"
    backup_index=$((backup_index + 1))
  done
  mv "$DIR/daemon.log" "$DAEMON_LOG_BACKUP" || fail "无法归档现有 daemon 日志"
fi

launchctl unload "$PLIST" >/dev/null 2>&1 || true
if [ -f "$LEGACY_PLIST" ]; then
  launchctl unload "$LEGACY_PLIST" >/dev/null 2>&1 || true
  LEGACY_SERVICE_UNLOADED=1
fi
launchctl load "$PLIST" || fail "launchd 注册失败"
CANONICAL_SERVICE_LOADED=1

# 只有新 daemon 已成功向服务器注册后，才移除旧服务入口。
if [ "${DI_AGENT_SKIP_HEALTH_CHECK:-0}" != "1" ]; then
  health_ok=0
  health_attempt=0
  health_attempt_limit="${DI_AGENT_HEALTH_CHECK_ATTEMPTS:-30}"
  while [ "$health_attempt" -lt "$health_attempt_limit" ]; do
    if grep -q 'stage=daemon.ready' "$DIR/daemon.log" 2>/dev/null; then
      health_ok=1
      break
    fi
    sleep 1
    health_attempt=$((health_attempt + 1))
  done
  [ "$health_ok" -eq 1 ] || fail "daemon 未能在 ${health_attempt_limit} 秒内连接服务器，已保留旧服务以便回滚"
fi

if [ -f "$LEGACY_PLIST" ]; then
  mkdir -p "$DIR/compat-backup"
  LEGACY_PLIST_BACKUP="$DIR/compat-backup/launch-agent.plist"
  mv "$LEGACY_PLIST" "$LEGACY_PLIST_BACKUP" || fail "无法归档旧服务配置"
fi

# 旧 npm 包只保留在兼容备份中，不再留在活动 node_modules 路径。
LEGACY_PACKAGE="$DIR/node_modules/@hust-agenthub/daemon" # [brand-compat]
if [ -e "$LEGACY_PACKAGE" ] || [ -L "$LEGACY_PACKAGE" ]; then
  mkdir -p "$DIR/compat-backup"
  LEGACY_PACKAGE_BACKUP="$DIR/compat-backup/previous-daemon-package"
  mv "$LEGACY_PACKAGE" "$LEGACY_PACKAGE_BACKUP" || fail "无法归档旧 daemon 包"
fi
LEGACY_BIN="$DIR/node_modules/.bin/agenthub-daemon" # [brand-compat]
if [ -e "$LEGACY_BIN" ] || [ -L "$LEGACY_BIN" ]; then
  mkdir -p "$DIR/compat-backup"
  LEGACY_BIN_BACKUP="$DIR/compat-backup/previous-daemon-bin"
  mv "$LEGACY_BIN" "$LEGACY_BIN_BACKUP" || fail "无法归档旧 daemon 命令入口"
fi
rmdir "$DIR/node_modules/@hust-agenthub" >/dev/null 2>&1 || true # [brand-compat]

INSTALL_COMMITTED=1
trap - EXIT

say "安装完成！daemon 已在后台运行，并已注册开机自启"
say "现在回到浏览器刷新页面，本机会自动显示为 Connected"
say "日志: $DIR/daemon.log"
