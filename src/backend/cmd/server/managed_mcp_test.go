package main

import (
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"testing"
)

func TestManagedMCPActivationToolRegisteredForExplicitGrant(t *testing.T) {
	registry := service.NewToolRegistry(nil)
	registerAllToolSpecs(registry)
	spec, ok := registry.Lookup("set_managed_mcp_enabled")
	if !ok {
		t.Fatal("activation permission must survive backend tool-config validation")
	}
	if spec.RouteInfo() != nil {
		t.Fatal("activation is local; no server route receives personal credentials")
	}
}
