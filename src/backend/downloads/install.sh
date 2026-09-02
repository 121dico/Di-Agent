#!/bin/bash
# AgentHub daemon macOS 安装脚本（由 curl|bash 调用）
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

say() { printf '\033[36m[AgentHub]\033[0m %s\n' "$*"; }
fail() { printf '\033[31m[AgentHub] 安装失败: %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$SERVER_URL" ] && [ -n "$API_KEY" ] || fail "缺少 --server-url 或 --api-key 参数"

DIR="$HOME/.agenthub"
PLIST="$HOME/Library/LaunchAgents/com.agenthub.daemon.plist"
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
curl -fsSL "$SERVER_URL/downloads/agenthub-daemon-bundle.tar.gz" -o "$DIR/bundle.tar.gz" || fail "daemon 包下载失败（请确认能访问 $SERVER_URL）"
tar xzf "$DIR/bundle.tar.gz" -C "$DIR" || fail "daemon 包解压失败"
DAEMON_JS="$DIR/node_modules/@hust-agenthub/daemon/bin/agenthub-daemon.js"
[ -f "$DAEMON_JS" ] || fail "daemon 入口文件缺失"

# --- 3. 启动脚本（幂等: 重跑即更新 Key 并重启）---
# PATH 固化为当前终端的完整 PATH: launchd 拉起进程时默认 PATH 只有 /usr/bin:/bin，
# 不固化的话 daemon 扫不到 claude/codex 等 CLI。
cat > "$DIR/start-daemon.sh" <<EOF
#!/bin/bash
export PATH="$PATH"
exec "$NODE_BIN" "$DAEMON_JS" --server-url "$SERVER_URL" --api-key "$API_KEY"
EOF
chmod +x "$DIR/start-daemon.sh"

# --- 4. 用户级 launchd 开机自启 + 立即启动（无需管理员密码）---
mkdir -p "$(dirname "$PLIST")"
cat > "$PLIST" <<EOF2
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.agenthub.daemon</string>
  <key>ProgramArguments</key><array><string>$DIR/start-daemon.sh</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/daemon.log</string>
  <key>StandardErrorPath</key><string>$DIR/daemon.err.log</string>
</dict></plist>
EOF2

launchctl unload "$PLIST" >/dev/null 2>&1 || true
launchctl load "$PLIST" || fail "launchd 注册失败"

say "安装完成！daemon 已在后台运行，并已注册开机自启"
say "现在回到浏览器刷新页面，本机会自动显示为 Connected"
say "日志: $DIR/daemon.log"
