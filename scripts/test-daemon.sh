#!/bin/bash
# 运行 Go daemon 测试。
set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
GO_BIN="${GO_BIN:-go}"

if ! command -v "$GO_BIN" >/dev/null 2>&1; then
  if command -v go.exe >/dev/null 2>&1; then
    GO_BIN="go.exe"
  else
    echo "go/go.exe not found in PATH" >&2
    exit 127
  fi
fi

cd "$REPO_ROOT/src/daemon"
if [[ $# -eq 0 ]]; then
  set -- ./...
fi
exec "$GO_BIN" test "$@" -count=1 -timeout 60s
