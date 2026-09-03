#!/bin/bash

set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$REPO_ROOT/src/frontend"
if [[ $# -eq 0 ]]; then
  set -- src
fi
exec npm exec vitest run -- "$@"
