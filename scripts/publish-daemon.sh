#!/usr/bin/env bash
set -euo pipefail

# Daemon 只通过 Di Agent 后端托管的离线包分发，不发布 npm 包。
printf '%s\n' '已禁用 npm 发布。请运行 bash scripts/package-daemon.sh 生成后端托管的离线包。' >&2
exit 1
