#!/bin/bash

set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
INSTALL_SCRIPT="$REPO_ROOT/scripts/install.sh"
DISTRIBUTED_INSTALL_SCRIPT="$REPO_ROOT/src/backend/downloads/install.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/di-agent-install-test.XXXXXX")"
DEFAULT_LEGACY_DIR="$HOME/.agenthub" # [brand-compat] 仅用于验证测试不会触碰真实旧目录。
DEFAULT_LEGACY_PLIST="$HOME/Library/LaunchAgents/com.agenthub.daemon.plist" # [brand-compat]

path_identity() {
  target=$1
  if [ ! -e "$target" ] && [ ! -L "$target" ]; then
    printf '%s\n' missing
  elif stat -f '%HT:%i:%m:%z' "$target" >/dev/null 2>&1; then
    stat -f '%HT:%i:%m:%z' "$target"
  else
    stat -c '%F:%i:%Y:%s' "$target"
  fi
}

DEFAULT_LEGACY_DIR_BEFORE="$(path_identity "$DEFAULT_LEGACY_DIR")"
DEFAULT_LEGACY_PLIST_BEFORE="$(path_identity "$DEFAULT_LEGACY_PLIST")"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/di-agent-install-test.*)
      find "$TEST_ROOT" -depth -delete
      ;;
  esac
}
trap cleanup EXIT

fail_test() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

assert_file() {
  [ -f "$1" ] || fail_test "expected file: $1"
}

assert_equals() {
  [ "$1" = "$2" ] || fail_test "expected '$2', got '$1'"
}

make_valid_archive() {
  archive=$1
  stage=$2
  daemon_bin="$stage/node_modules/di-agent-daemon/bin"
  mkdir -p "$daemon_bin"
  printf '%s\n' '#!/usr/bin/env node' 'console.log("fixture daemon");' > "$daemon_bin/di-agent-daemon.js"
  tar czf "$archive" -C "$stage" node_modules
}

make_fake_commands() {
  fake_bin=$1
  mkdir -p "$fake_bin"

  cat > "$fake_bin/node" <<'EOF'
#!/bin/bash
if [ "${1:-}" = "-v" ]; then
  printf '%s\n' 'v20.0.0'
fi
EOF

  cat > "$fake_bin/curl" <<'EOF'
#!/bin/bash
output=''
while [ "$#" -gt 0 ]; do
  if [ "$1" = '-o' ]; then
    output=${2:-}
    shift 2
  else
    shift
  fi
done
case "$output" in
  "$DI_AGENT_EXPECTED_INSTALL_DIR"/*) ;;
  *)
    printf 'refusing unexpected output path: %s\n' "$output" >&2
    exit 70
    ;;
esac
cp "$DI_AGENT_TEST_ARCHIVE" "$output"
EOF

cat > "$fake_bin/launchctl" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >> "$DI_AGENT_LAUNCHCTL_LOG"
if [ "${1:-}" = "load" ] && [ "${2:-}" = "$DI_AGENT_LAUNCH_AGENT_PLIST" ] && \
  [ "${DI_AGENT_TEST_WRITE_READY:-0}" = "1" ]; then
  printf '%s\n' 'daemon_flow level=info stage=daemon.ready' >> "$DI_AGENT_EXPECTED_INSTALL_DIR/daemon.log"
fi
exit 0
EOF

  chmod +x "$fake_bin/node" "$fake_bin/curl" "$fake_bin/launchctl"
}

test_normal_install_uses_isolated_paths() {
  case_root="$TEST_ROOT/normal"
  install_dir="$case_root/install"
  plist="$case_root/LaunchAgents/com.diagent.daemon.plist"
  legacy_dir="$case_root/legacy-home"
  legacy_plist="$case_root/LaunchAgents/com.agenthub.daemon.plist" # [brand-compat]
  archive="$case_root/bundle.tar.gz"
  fake_bin="$case_root/bin"
  mkdir -p "$case_root/stage"
  make_valid_archive "$archive" "$case_root/stage"
  make_fake_commands "$fake_bin"

  if ! DI_AGENT_INSTALL_DIR="$install_dir" \
    DI_AGENT_LAUNCH_AGENT_PLIST="$plist" \
    DI_AGENT_LEGACY_INSTALL_DIR="$legacy_dir" \
    DI_AGENT_LEGACY_LAUNCH_AGENT_PLIST="$legacy_plist" \
    DI_AGENT_EXPECTED_INSTALL_DIR="$install_dir" \
    DI_AGENT_TEST_WRITE_READY=1 \
    DI_AGENT_TEST_ARCHIVE="$archive" \
    DI_AGENT_LAUNCHCTL_LOG="$case_root/launchctl.log" \
    PATH="$fake_bin:/usr/bin:/bin" \
    bash "$INSTALL_SCRIPT" \
      --server-url http://di-agent.test \
      --api-key sk_test_placeholder > "$case_root/output.log" 2>&1; then
    sed -n '1,120p' "$case_root/output.log" >&2
    fail_test 'normal isolated installation should succeed'
  fi

  assert_file "$install_dir/node_modules/di-agent-daemon/bin/di-agent-daemon.js"
  assert_file "$plist"
  assert_file "$install_dir/start-daemon.sh"
}

test_existing_daemon_symlink_is_preserved_and_replaced() {
  case_root="$TEST_ROOT/symlink-success"
  install_dir="$case_root/install"
  plist="$case_root/LaunchAgents/com.diagent.daemon.plist"
  legacy_dir="$case_root/legacy-home"
  legacy_plist="$case_root/LaunchAgents/com.agenthub.daemon.plist" # [brand-compat]
  archive="$case_root/bundle.tar.gz"
  fake_bin="$case_root/bin"
  daemon_parent="$install_dir/node_modules"
  daemon_package="$daemon_parent/di-agent-daemon"
  source_dir="$install_dir/local-daemon-source"
  mkdir -p "$case_root/stage" "$daemon_parent" "$source_dir"
  printf '%s\n' 'keep this source unchanged' > "$source_dir/sentinel.txt"
  ln -s ../local-daemon-source "$daemon_package"
  printf '%s\n' 'reserved backup name' > "$daemon_package.local-dev-link"
  make_valid_archive "$archive" "$case_root/stage"
  make_fake_commands "$fake_bin"

  if ! DI_AGENT_INSTALL_DIR="$install_dir" \
    DI_AGENT_LAUNCH_AGENT_PLIST="$plist" \
    DI_AGENT_LEGACY_INSTALL_DIR="$legacy_dir" \
    DI_AGENT_LEGACY_LAUNCH_AGENT_PLIST="$legacy_plist" \
    DI_AGENT_EXPECTED_INSTALL_DIR="$install_dir" \
    DI_AGENT_TEST_ARCHIVE="$archive" \
    DI_AGENT_LAUNCHCTL_LOG="$case_root/launchctl.log" \
    DI_AGENT_SKIP_HEALTH_CHECK=1 \
    PATH="$fake_bin:/usr/bin:/bin" \
    bash "$INSTALL_SCRIPT" \
      --server-url http://di-agent.test \
      --api-key sk_test_placeholder > "$case_root/output.log" 2>&1; then
    sed -n '1,120p' "$case_root/output.log" >&2
    fail_test 'installation should migrate an existing daemon symlink'
  fi

  [ -d "$daemon_package" ] || fail_test 'new daemon should be a directory'
  [ ! -L "$daemon_package" ] || fail_test 'new daemon must not remain a symlink'
  assert_file "$daemon_package/bin/di-agent-daemon.js"
  assert_equals "$(cat "$source_dir/sentinel.txt")" 'keep this source unchanged'
  assert_equals "$(cat "$daemon_package.local-dev-link")" 'reserved backup name'
  [ -L "$daemon_package.local-dev-link.1" ] || fail_test 'expected recoverable daemon link backup'
  assert_equals "$(readlink "$daemon_package.local-dev-link.1")" '../local-daemon-source'
  assert_file "$daemon_package.local-dev-link.1/sentinel.txt"
}

test_failed_extraction_restores_daemon_symlink() {
  case_root="$TEST_ROOT/symlink-rollback"
  install_dir="$case_root/install"
  plist="$case_root/LaunchAgents/com.diagent.daemon.plist"
  legacy_dir="$case_root/legacy-home"
  legacy_plist="$case_root/LaunchAgents/com.agenthub.daemon.plist" # [brand-compat]
  archive="$case_root/broken-bundle.tar.gz"
  fake_bin="$case_root/bin"
  daemon_parent="$install_dir/node_modules"
  daemon_package="$daemon_parent/di-agent-daemon"
  source_dir="$install_dir/local-daemon-source"
  mkdir -p "$daemon_parent" "$source_dir"
  printf '%s\n' 'keep rollback source unchanged' > "$source_dir/sentinel.txt"
  ln -s ../local-daemon-source "$daemon_package"
  printf '%s\n' 'this is not a tar archive' > "$archive"
  make_fake_commands "$fake_bin"

  if DI_AGENT_INSTALL_DIR="$install_dir" \
    DI_AGENT_LAUNCH_AGENT_PLIST="$plist" \
    DI_AGENT_LEGACY_INSTALL_DIR="$legacy_dir" \
    DI_AGENT_LEGACY_LAUNCH_AGENT_PLIST="$legacy_plist" \
    DI_AGENT_EXPECTED_INSTALL_DIR="$install_dir" \
    DI_AGENT_TEST_ARCHIVE="$archive" \
    DI_AGENT_LAUNCHCTL_LOG="$case_root/launchctl.log" \
    DI_AGENT_SKIP_HEALTH_CHECK=1 \
    PATH="$fake_bin:/usr/bin:/bin" \
    bash "$INSTALL_SCRIPT" \
      --server-url http://di-agent.test \
      --api-key sk_test_placeholder > "$case_root/output.log" 2>&1; then
    fail_test 'broken daemon archive should fail installation'
  fi

  [ -L "$daemon_package" ] || fail_test 'failed extraction should restore original daemon symlink'
  assert_equals "$(readlink "$daemon_package")" '../local-daemon-source'
  assert_file "$daemon_package/sentinel.txt"
  [ ! -e "$daemon_package.local-dev-link" ] && \
    [ ! -L "$daemon_package.local-dev-link" ] || \
    fail_test 'rollback should not leave the moved link behind'
  grep -q 'daemon 包解压失败' "$case_root/output.log" || fail_test 'expected extraction failure message'
}

test_retired_installation_moves_to_canonical_home_without_losing_sessions() {
  case_root="$TEST_ROOT/legacy-success"
  install_dir="$case_root/home/.di-agent"
  legacy_dir="$case_root/home/.agenthub" # [brand-compat] 隔离的旧安装夹具。
  plist="$case_root/LaunchAgents/com.diagent.daemon.plist"
  legacy_plist="$case_root/LaunchAgents/com.agenthub.daemon.plist" # [brand-compat]
  archive="$case_root/bundle.tar.gz"
  fake_bin="$case_root/bin"
  mkdir -p "$case_root/stage" "$legacy_dir/node_modules/@hust-agenthub/daemon/bin" "$legacy_dir/node_modules/.bin" "$(dirname "$legacy_plist")" # [brand-compat]
  printf '%s\n' '{"agent-1":"session-1"}' > "$legacy_dir/sessions.json"
  printf '%s\n' 'retired daemon entry' > "$legacy_dir/node_modules/@hust-agenthub/daemon/bin/agenthub-daemon.js" # [brand-compat]
  ln -s ../@hust-agenthub/daemon/bin/agenthub-daemon.js "$legacy_dir/node_modules/.bin/agenthub-daemon" # [brand-compat]
  printf '%s\n' '<plist>retired service</plist>' > "$legacy_plist"
  make_valid_archive "$archive" "$case_root/stage"
  make_fake_commands "$fake_bin"

  DI_AGENT_INSTALL_DIR="$install_dir" \
    DI_AGENT_LEGACY_INSTALL_DIR="$legacy_dir" \
    DI_AGENT_LAUNCH_AGENT_PLIST="$plist" \
    DI_AGENT_LEGACY_LAUNCH_AGENT_PLIST="$legacy_plist" \
    DI_AGENT_EXPECTED_INSTALL_DIR="$install_dir" \
    DI_AGENT_TEST_WRITE_READY=1 \
    DI_AGENT_TEST_ARCHIVE="$archive" \
    DI_AGENT_LAUNCHCTL_LOG="$case_root/launchctl.log" \
    PATH="$fake_bin:/usr/bin:/bin" \
    bash "$INSTALL_SCRIPT" \
      --server-url http://di-agent.test \
      --api-key sk_test_placeholder > "$case_root/output.log" 2>&1

  assert_equals "$(cat "$install_dir/sessions.json")" '{"agent-1":"session-1"}'
  [ ! -e "$legacy_dir" ] || fail_test 'retired install directory should be removed after success'
  [ ! -e "$legacy_plist" ] || fail_test 'retired LaunchAgent should be removed after success'
  grep -q 'unload.*com.agenthub.daemon.plist' "$case_root/launchctl.log" || fail_test 'retired service must be unloaded' # [brand-compat]
  grep -q 'load.*com.diagent.daemon.plist' "$case_root/launchctl.log" || fail_test 'canonical service must be loaded'
  grep -q 'com.diagent.daemon' "$plist" || fail_test 'canonical plist label is required'
  [ ! -e "$install_dir/node_modules/@hust-agenthub/daemon" ] && [ ! -L "$install_dir/node_modules/@hust-agenthub/daemon" ] || fail_test 'retired daemon package must leave active node_modules after health succeeds' # [brand-compat]
  [ ! -e "$install_dir/node_modules/.bin/agenthub-daemon" ] && [ ! -L "$install_dir/node_modules/.bin/agenthub-daemon" ] || fail_test 'retired daemon bin must leave the active command directory' # [brand-compat]
  assert_file "$install_dir/compat-backup/previous-daemon-package/bin/agenthub-daemon.js" # [brand-compat]
}

test_stale_ready_log_cannot_commit_a_failed_migration() {
  case_root="$TEST_ROOT/stale-health-log"
  install_dir="$case_root/home/.di-agent"
  legacy_dir="$case_root/home/.agenthub" # [brand-compat]
  plist="$case_root/LaunchAgents/com.diagent.daemon.plist"
  legacy_plist="$case_root/LaunchAgents/com.agenthub.daemon.plist" # [brand-compat]
  archive="$case_root/bundle.tar.gz"
  fake_bin="$case_root/bin"
  mkdir -p "$case_root/stage" "$legacy_dir" "$(dirname "$legacy_plist")"
  printf '%s\n' 'daemon_flow level=info stage=daemon.ready' > "$legacy_dir/daemon.log"
  printf '%s\n' '#!/bin/bash' 'echo retired-start' > "$legacy_dir/start-daemon.sh"
  printf '%s\n' '<plist>retired service</plist>' > "$legacy_plist"
  make_valid_archive "$archive" "$case_root/stage"
  make_fake_commands "$fake_bin"

  if DI_AGENT_INSTALL_DIR="$install_dir" \
    DI_AGENT_LEGACY_INSTALL_DIR="$legacy_dir" \
    DI_AGENT_LAUNCH_AGENT_PLIST="$plist" \
    DI_AGENT_LEGACY_LAUNCH_AGENT_PLIST="$legacy_plist" \
    DI_AGENT_EXPECTED_INSTALL_DIR="$install_dir" \
    DI_AGENT_TEST_ARCHIVE="$archive" \
    DI_AGENT_LAUNCHCTL_LOG="$case_root/launchctl.log" \
    DI_AGENT_HEALTH_CHECK_ATTEMPTS=1 \
    PATH="$fake_bin:/usr/bin:/bin" \
    bash "$INSTALL_SCRIPT" \
      --server-url http://di-agent.test \
      --api-key sk_test_placeholder > "$case_root/output.log" 2>&1; then
    fail_test 'a stale ready line must not satisfy the new daemon health check'
  fi

  assert_file "$legacy_dir/daemon.log"
  assert_equals "$(tail -n 1 "$legacy_dir/start-daemon.sh")" 'echo retired-start'
  grep -q 'stage=daemon.ready' "$legacy_dir/daemon.log" || fail_test 'rollback must restore the previous log'
  [ ! -e "$install_dir" ] || fail_test 'failed health check must restore the retired home'
  assert_file "$legacy_plist"
}

test_failed_retired_migration_rolls_back_the_original_home() {
  case_root="$TEST_ROOT/legacy-rollback"
  install_dir="$case_root/home/.di-agent"
  legacy_dir="$case_root/home/.agenthub" # [brand-compat]
  plist="$case_root/LaunchAgents/com.diagent.daemon.plist"
  legacy_plist="$case_root/LaunchAgents/com.agenthub.daemon.plist" # [brand-compat]
  archive="$case_root/broken-bundle.tar.gz"
  fake_bin="$case_root/bin"
  mkdir -p "$legacy_dir" "$(dirname "$legacy_plist")"
  printf '%s\n' '{"agent-1":"session-1"}' > "$legacy_dir/sessions.json"
  printf '%s\n' '<plist>retired service</plist>' > "$legacy_plist"
  printf '%s\n' 'not a tar archive' > "$archive"
  make_fake_commands "$fake_bin"

  if DI_AGENT_INSTALL_DIR="$install_dir" \
    DI_AGENT_LEGACY_INSTALL_DIR="$legacy_dir" \
    DI_AGENT_LAUNCH_AGENT_PLIST="$plist" \
    DI_AGENT_LEGACY_LAUNCH_AGENT_PLIST="$legacy_plist" \
    DI_AGENT_EXPECTED_INSTALL_DIR="$install_dir" \
    DI_AGENT_TEST_ARCHIVE="$archive" \
    DI_AGENT_LAUNCHCTL_LOG="$case_root/launchctl.log" \
    DI_AGENT_SKIP_HEALTH_CHECK=1 \
    PATH="$fake_bin:/usr/bin:/bin" \
    bash "$INSTALL_SCRIPT" \
      --server-url http://di-agent.test \
      --api-key sk_test_placeholder > "$case_root/output.log" 2>&1; then
    fail_test 'broken bundle should fail a retired-home migration'
  fi

  assert_file "$legacy_dir/sessions.json"
  [ ! -e "$install_dir" ] || fail_test 'failed migration must restore the original home'
  assert_file "$legacy_plist"
}

test_distributed_script_matches_source() {
  cmp -s "$INSTALL_SCRIPT" "$DISTRIBUTED_INSTALL_SCRIPT" || \
    fail_test 'distributed install.sh must match scripts/install.sh byte-for-byte'
}

test_offline_bundle_is_symlink_free() {
  if tar tvzf "$REPO_ROOT/src/backend/downloads/di-agent-daemon-bundle.tar.gz" | grep -q '^l'; then
    fail_test 'daemon offline bundle must be symlink-free for legacy macOS tar'
  fi
}

test_normal_install_uses_isolated_paths
test_existing_daemon_symlink_is_preserved_and_replaced
test_failed_extraction_restores_daemon_symlink
test_retired_installation_moves_to_canonical_home_without_losing_sessions
test_stale_ready_log_cannot_commit_a_failed_migration
test_failed_retired_migration_rolls_back_the_original_home
test_distributed_script_matches_source
test_offline_bundle_is_symlink_free
[ "$(path_identity "$DEFAULT_LEGACY_DIR")" = "$DEFAULT_LEGACY_DIR_BEFORE" ] || \
  fail_test 'tests must not mutate the default retired install directory'
[ "$(path_identity "$DEFAULT_LEGACY_PLIST")" = "$DEFAULT_LEGACY_PLIST_BEFORE" ] || \
  fail_test 'tests must not mutate the default retired LaunchAgent plist'
printf '%s\n' 'PASS: install.sh regression tests'
