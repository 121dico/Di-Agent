#!/bin/bash
set -euo pipefail
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$REPO_ROOT/src/daemon-npm"
exec node --test "$@" cli/__tests__/codex.test.js bin/di-agent-daemon.test.js
