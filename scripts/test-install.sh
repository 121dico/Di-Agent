#!/bin/bash

set -euo pipefail

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
INSTALL_SCRIPT="$REPO_ROOT/scripts/install.sh"
DISTRIBUTED_INSTALL_SCRIPT="$REPO_ROOT/src/backend/downloads/install.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/agenthub-install-test.XXXXXX")"

cleanup() {
  case "$TEST_ROOT" in
    "${TMPDIR:-/tmp}"/agenthub-install-test.*)
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
  daemon_bin="$stage/node_modules/@hust-agenthub/daemon/bin"
  mkdir -p "$daemon_bin"
  printf '%s\n' '#!/usr/bin/env node' 'console.log("fixture daemon");' > "$daemon_bin/agenthub-daemon.js"
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
  "$AGENTHUB_EXPECTED_INSTALL_DIR"/*) ;;
  *)
    printf 'refusing unexpected output path: %s\n' "$output" >&2
    exit 70
    ;;
esac
cp "$AGENTHUB_TEST_ARCHIVE" "$output"
EOF

  cat > "$fake_bin/launchctl" <<'EOF'
#!/bin/bash
exit 0
EOF

  chmod +x "$fake_bin/node" "$fake_bin/curl" "$fake_bin/launchctl"
}

test_normal_install_uses_isolated_paths() {
  case_root="$TEST_ROOT/normal"
  install_dir="$case_root/install"
  plist="$case_root/LaunchAgents/com.agenthub.daemon.plist"
  archive="$case_root/bundle.tar.gz"
  fake_bin="$case_root/bin"
  mkdir -p "$case_root/stage"
  make_valid_archive "$archive" "$case_root/stage"
  make_fake_commands "$fake_bin"

  if ! AGENTHUB_INSTALL_DIR="$install_dir" \
    AGENTHUB_LAUNCH_AGENT_PLIST="$plist" \
    AGENTHUB_EXPECTED_INSTALL_DIR="$install_dir" \
    AGENTHUB_TEST_ARCHIVE="$archive" \
    PATH="$fake_bin:/usr/bin:/bin" \
    bash "$INSTALL_SCRIPT" \
      --server-url http://agenthub.test \
      --api-key sk_test_placeholder > "$case_root/output.log" 2>&1; then
    sed -n '1,120p' "$case_root/output.log" >&2
    fail_test 'normal isolated installation should succeed'
  fi

  assert_file "$install_dir/node_modules/@hust-agenthub/daemon/bin/agenthub-daemon.js"
  assert_file "$plist"
  assert_file "$install_dir/start-daemon.sh"
}

test_existing_daemon_symlink_is_preserved_and_replaced() {
  case_root="$TEST_ROOT/symlink-success"
  install_dir="$case_root/install"
  plist="$case_root/LaunchAgents/com.agenthub.daemon.plist"
  archive="$case_root/bundle.tar.gz"
  fake_bin="$case_root/bin"
  daemon_parent="$install_dir/node_modules/@hust-agenthub"
  source_dir="$install_dir/local-daemon-source"
  mkdir -p "$case_root/stage" "$daemon_parent" "$source_dir"
  printf '%s\n' 'keep this source unchanged' > "$source_dir/sentinel.txt"
  ln -s ../../local-daemon-source "$daemon_parent/daemon"
  printf '%s\n' 'reserved backup name' > "$daemon_parent/daemon.local-dev-link"
  make_valid_archive "$archive" "$case_root/stage"
  make_fake_commands "$fake_bin"

  if ! AGENTHUB_INSTALL_DIR="$install_dir" \
    AGENTHUB_LAUNCH_AGENT_PLIST="$plist" \
    AGENTHUB_EXPECTED_INSTALL_DIR="$install_dir" \
    AGENTHUB_TEST_ARCHIVE="$archive" \
    PATH="$fake_bin:/usr/bin:/bin" \
    bash "$INSTALL_SCRIPT" \
      --server-url http://agenthub.test \
      --api-key sk_test_placeholder > "$case_root/output.log" 2>&1; then
    sed -n '1,120p' "$case_root/output.log" >&2
    fail_test 'installation should migrate an existing daemon symlink'
  fi

  [ -d "$daemon_parent/daemon" ] || fail_test 'new daemon should be a directory'
  [ ! -L "$daemon_parent/daemon" ] || fail_test 'new daemon must not remain a symlink'
  assert_file "$daemon_parent/daemon/bin/agenthub-daemon.js"
  assert_equals "$(cat "$source_dir/sentinel.txt")" 'keep this source unchanged'
  assert_equals "$(cat "$daemon_parent/daemon.local-dev-link")" 'reserved backup name'
  [ -L "$daemon_parent/daemon.local-dev-link.1" ] || fail_test 'expected recoverable daemon link backup'
  assert_equals "$(readlink "$daemon_parent/daemon.local-dev-link.1")" '../../local-daemon-source'
  assert_file "$daemon_parent/daemon.local-dev-link.1/sentinel.txt"
}

test_failed_extraction_restores_daemon_symlink() {
  case_root="$TEST_ROOT/symlink-rollback"
  install_dir="$case_root/install"
  plist="$case_root/LaunchAgents/com.agenthub.daemon.plist"
  archive="$case_root/broken-bundle.tar.gz"
  fake_bin="$case_root/bin"
  daemon_parent="$install_dir/node_modules/@hust-agenthub"
  source_dir="$install_dir/local-daemon-source"
  mkdir -p "$daemon_parent" "$source_dir"
  printf '%s\n' 'keep rollback source unchanged' > "$source_dir/sentinel.txt"
  ln -s ../../local-daemon-source "$daemon_parent/daemon"
  printf '%s\n' 'this is not a tar archive' > "$archive"
  make_fake_commands "$fake_bin"

  if AGENTHUB_INSTALL_DIR="$install_dir" \
    AGENTHUB_LAUNCH_AGENT_PLIST="$plist" \
    AGENTHUB_EXPECTED_INSTALL_DIR="$install_dir" \
    AGENTHUB_TEST_ARCHIVE="$archive" \
    PATH="$fake_bin:/usr/bin:/bin" \
    bash "$INSTALL_SCRIPT" \
      --server-url http://agenthub.test \
      --api-key sk_test_placeholder > "$case_root/output.log" 2>&1; then
    fail_test 'broken daemon archive should fail installation'
  fi

  [ -L "$daemon_parent/daemon" ] || fail_test 'failed extraction should restore original daemon symlink'
  assert_equals "$(readlink "$daemon_parent/daemon")" '../../local-daemon-source'
  assert_file "$daemon_parent/daemon/sentinel.txt"
  [ ! -e "$daemon_parent/daemon.local-dev-link" ] && \
    [ ! -L "$daemon_parent/daemon.local-dev-link" ] || \
    fail_test 'rollback should not leave the moved link behind'
  grep -q 'daemon 包解压失败' "$case_root/output.log" || fail_test 'expected extraction failure message'
}

test_distributed_script_matches_source() {
  cmp -s "$INSTALL_SCRIPT" "$DISTRIBUTED_INSTALL_SCRIPT" || \
    fail_test 'distributed install.sh must match scripts/install.sh byte-for-byte'
}

test_normal_install_uses_isolated_paths
test_existing_daemon_symlink_is_preserved_and_replaced
test_failed_extraction_restores_daemon_symlink
test_distributed_script_matches_source
printf '%s\n' 'PASS: install.sh regression tests'
