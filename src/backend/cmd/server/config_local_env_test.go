package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadLocalEnvironmentLoadsMissingValuesWithoutOverridingProcessEnv(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, ".env.local")
	if err := os.WriteFile(path, []byte("# local report credentials\nREPORT_TEST_FROM_FILE='file-value'\nREPORT_TEST_PRECEDENCE=file-value\n"), 0o600); err != nil {
		t.Fatalf("write local environment fixture: %v", err)
	}

	t.Setenv("REPORT_TEST_PRECEDENCE", "process-value")
	if err := os.Unsetenv("REPORT_TEST_FROM_FILE"); err != nil {
		t.Fatalf("unset fixture environment: %v", err)
	}
	t.Cleanup(func() { _ = os.Unsetenv("REPORT_TEST_FROM_FILE") })

	if err := loadLocalEnvironment(path); err != nil {
		t.Fatalf("loadLocalEnvironment returned error: %v", err)
	}
	if got := os.Getenv("REPORT_TEST_FROM_FILE"); got != "file-value" {
		t.Fatalf("file value = %q, want file-value", got)
	}
	if got := os.Getenv("REPORT_TEST_PRECEDENCE"); got != "process-value" {
		t.Fatalf("process environment must win, got %q", got)
	}
}

func TestLoadLocalEnvironmentAllowsMissingOptionalFile(t *testing.T) {
	if err := loadLocalEnvironment(filepath.Join(t.TempDir(), "missing.env")); err != nil {
		t.Fatalf("missing optional environment file returned error: %v", err)
	}
}
