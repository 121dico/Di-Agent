#!/bin/bash

set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SOURCE="$REPO_ROOT/scripts/install.ps1"
DISTRIBUTED="$REPO_ROOT/src/backend/downloads/install.ps1"

fail_test() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

cmp -s "$SOURCE" "$DISTRIBUTED" || fail_test 'distributed install.ps1 must match source'
grep -Fq "'.di-agent'" "$SOURCE" || fail_test 'canonical Windows home is required'
grep -Fq "'di-agent-daemon-bundle.tar.gz'" "$SOURCE" || fail_test 'canonical bundle name is required'
grep -Fq "'node_modules\di-agent-daemon\bin\di-agent-daemon.js'" "$SOURCE" || fail_test 'installer and package tree must agree'
grep -Fq "'di-agent-daemon.cmd'" "$SOURCE" || fail_test 'canonical startup filename is required'
grep -Fq 'DI_AGENT_LEGACY_INSTALL_DIR' "$SOURCE" || fail_test 'retired home migration must be configurable for isolated tests'
grep -Fq 'stage=daemon.ready' "$SOURCE" || fail_test 'retired state must only be cleaned after daemon health'
grep -Fq 'Copy-Item -Path $LegacyDir -Destination $Dir -Recurse' "$SOURCE" || fail_test 'retired home must remain intact until the canonical daemon is healthy'
grep -Fq "'previous-daemon-package'" "$SOURCE" || fail_test 'retired daemon package must leave active node_modules after health'
grep -Fq '[Di Agent]' "$SOURCE" || fail_test 'user-visible installer branding must be canonical'

health_line="$(grep -n 'if ($env:DI_AGENT_SKIP_HEALTH_CHECK' "$SOURCE" | head -1 | cut -d: -f1)"
legacy_stop_line="$(grep -n "agenthub-daemon.js" "$SOURCE" | tail -1 | cut -d: -f1)" # [brand-compat]
[ "$legacy_stop_line" -gt "$health_line" ] || fail_test 'retired daemon process must not stop before canonical health verification'

printf '%s\n' 'PASS: install.ps1 contract tests'
