#!/bin/bash
# 始终在隔离测试中运行本机 MCP 接入验收。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node --test "$ROOT/src/daemon-npm/bin/managed-mcp-onboarding.test.js"
