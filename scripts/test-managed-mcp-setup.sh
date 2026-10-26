#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
node --test "$ROOT/src/daemon-npm/bin/managed-mcp.test.js" "$ROOT/src/daemon-npm/bin/managed-mcp-credentials.test.js" "$ROOT/src/daemon-npm/bin/managed-mcp-setup.test.js" "$ROOT/src/daemon-npm/bin/managed-mcp-inline.test.js"
