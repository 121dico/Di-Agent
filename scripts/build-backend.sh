#!/usr/bin/env bash
# 仅构建后端；GOOS/GOARCH 可由发布环境指定，不触碰前端产物。
set -euo pipefail
REPO_ROOT="$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)"
GO_BIN="${GO_BIN:-go}"
if ! command -v "$GO_BIN" >/dev/null 2>&1; then
  if command -v go.exe >/dev/null 2>&1; then
    GO_BIN="go.exe"
  else
    echo "go/go.exe not found in PATH" >&2
    exit 127
  fi
fi
mkdir -p "$REPO_ROOT/bin"
cd "$REPO_ROOT/src/backend"
CGO_ENABLED=0 "$GO_BIN" build -o "$REPO_ROOT/bin/server" ./cmd/server
echo "构建完成: $REPO_ROOT/bin/server"
