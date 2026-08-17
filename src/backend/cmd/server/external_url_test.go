package main

import "testing"

func TestResolveExternalURLDefaultsToLoopback(t *testing.T) {
	t.Setenv("SERVER_EXTERNAL_URL", "")
	cfg := &Config{}
	cfg.Server.Port = 8080

	if got := resolveExternalURL(cfg); got != "http://127.0.0.1:8080" {
		t.Fatalf("resolveExternalURL() = %q, want loopback URL", got)
	}
}

func TestResolveExternalURLUsesExplicitAddress(t *testing.T) {
	t.Setenv("SERVER_EXTERNAL_URL", "http://192.168.5.4:8080/")
	cfg := &Config{}
	cfg.Server.Port = 8080

	if got := resolveExternalURL(cfg); got != "http://192.168.5.4:8080" {
		t.Fatalf("resolveExternalURL() = %q, want explicit URL", got)
	}
}
