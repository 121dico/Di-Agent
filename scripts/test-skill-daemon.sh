#!/bin/bash
# Node daemon behavior tests; safe fixtures, no live daemon restart.
set -euo pipefail
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$REPO_ROOT/src/daemon-npm"
if [[ $# -eq 0 ]]; then
  set -- bin/*.test.js cli/__tests__/*.test.js
fi
exec node --test "$@"
