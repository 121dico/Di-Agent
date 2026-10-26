#!/bin/bash
set -euo pipefail
REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$REPO_ROOT/src/frontend"
if [[ "${1:-}" == "--build" ]]; then
  exec npm run build
fi
exec npm exec tsc -- -b
