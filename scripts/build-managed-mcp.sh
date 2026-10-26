#!/bin/bash
# 仅构建本次 MCP 服务端与离线连接包，不重建或替换线上前端。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/bin"
(cd "$ROOT/src/backend" && GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -o "$ROOT/bin/server" ./cmd/server)
bash "$ROOT/scripts/package-daemon.sh"
