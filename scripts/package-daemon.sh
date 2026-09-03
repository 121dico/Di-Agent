#!/bin/bash
# 打包 daemon 离线安装包到 src/backend/downloads/
# 产物：di-agent-daemon-bundle.tar.gz（daemon + 依赖 ws，解压即用，无需 npm/外网）
# 依赖：本机可访问 npm 源（默认走 npmmirror，可用 NPM_REGISTRY 覆盖）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="$ROOT/src/backend/downloads"
BUNDLE_NAME="di-agent-daemon-bundle.tar.gz"
REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"

mkdir -p "$OUT_DIR"
TMP_DIR="$(mktemp -d)"
cleanup_tmp_dir() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    find "$TMP_DIR" -depth -delete
  fi
}
trap cleanup_tmp_dir EXIT

# 先把本地源码打成 tgz 再安装（直接装目录会产生符号链接，tar 不会跟进）
echo "[1/3] 打包本地 daemon 源码并安装依赖（registry: ${REGISTRY}）..."
TGZ="$(cd "$ROOT/src/daemon-npm" && npm pack --pack-destination "$TMP_DIR" --loglevel=error | tail -1)"
cd "$TMP_DIR"
npm install "$TMP_DIR/$TGZ" --registry="$REGISTRY" --no-audit --no-fund --loglevel=error

# 安装器需兼容旧版 macOS BSD tar；离线包不保留 npm 生成的 .bin 符号链接。
find "$TMP_DIR/node_modules" -type l -delete
if find "$TMP_DIR/node_modules" -type l -print -quit | grep -q .; then
  echo "ERROR: daemon 离线包不得包含符号链接" >&2
  exit 1
fi

test -f "$TMP_DIR/node_modules/di-agent-daemon/bin/di-agent-daemon.js" || {
  echo "ERROR: daemon 入口文件缺失" >&2
  exit 1
}

echo "[2/3] 生成 $BUNDLE_NAME ..."
tar czf "$OUT_DIR/$BUNDLE_NAME" node_modules

# Windows/macOS 安装脚本随包分发（launcher / curl|bash 从此目录拉取）
for f in install.ps1 install.sh; do
  if [ -f "$ROOT/scripts/$f" ]; then
    echo "[3/3] 拷贝 $f ..."
    cp "$ROOT/scripts/$f" "$OUT_DIR/$f"
  fi
done

echo "完成：$OUT_DIR/$BUNDLE_NAME ($(du -h "$OUT_DIR/$BUNDLE_NAME" | cut -f1))"
