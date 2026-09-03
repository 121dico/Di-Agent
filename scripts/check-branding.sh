#!/bin/bash

set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
PATTERN='Agent[[:space:]_-]*Hub|agent[[:space:]_-]*hub'
FAILURES="$(mktemp "${TMPDIR:-/tmp}/di-agent-branding.XXXXXX")"

cleanup() {
  [ ! -f "$FAILURES" ] || find "$FAILURES" -delete
}
trap cleanup EXIT

cd "$REPO_ROOT"

# 退役名称只能出现在决策记录和带有显式兼容标记的迁移代码/测试中。
while IFS= read -r file; do
  [ -e "$file" ] || continue
  case "$file" in
    docs/adr/0001-di-agent-canonical-brand.md|.trellis/tasks/09-03-di-agent-canonical-brand/prd.md)
      continue
      ;;
  esac

  if printf '%s\n' "$file" | grep -qEi "$PATTERN"; then
    printf '%s:%s\n' "$file" '[path contains retired brand]' >> "$FAILURES"
  fi

  grep -nEI "$PATTERN" "$file" 2>/dev/null | while IFS= read -r match; do
    case "$match" in
      *'[brand-compat]'*) ;;
      *) printf '%s:%s\n' "$file" "$match" >> "$FAILURES" ;;
    esac
  done || true
done < <(
  {
    git ls-files --cached --others --exclude-standard
    find .trellis/tasks .trellis/workspace -type f -print 2>/dev/null || true
  } | LC_ALL=C sort -u
)

if [ -s "$FAILURES" ]; then
  printf '%s\n' 'Retired product branding remains outside the compatibility allowlist:' >&2
  sed -n '1,200p' "$FAILURES" >&2
  exit 1
fi

printf '%s\n' 'PASS: Di Agent is the sole canonical product brand'
