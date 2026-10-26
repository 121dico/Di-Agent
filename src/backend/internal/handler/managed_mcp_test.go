package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type managedMCPMachineRepo struct{ service.AgentRepo }

func (*managedMCPMachineRepo) GetDaemonMachineByAPIKeyHash(_ context.Context, hash string) (*model.DaemonMachine, error) {
	for key, user := range map[string]string{"sk_machine_owner": "owner", "sk_machine_other": "another"} {
		sum := sha256.Sum256([]byte(key))
		if hash == hex.EncodeToString(sum[:]) {
			return &model.DaemonMachine{ID: key, UserID: user}, nil
		}
	}
	return nil, nil
}

func TestManagedMCPCatalogRequiresMatchingMachineOwner(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	agentSvc := service.NewAgentService(&managedMCPMachineRepo{}, nil)
	daemon := NewDaemonHandler(agentSvc, nil, "shared-token", slog.Default(), nil, nil, nil, nil, nil)
	r.GET("/daemon/managed-mcps", daemon.WithMachineBearer(ManagedMCPCatalog))
	for _, tc := range []struct {
		query, key string
		status     int
	}{
		{"?user_id=owner", "sk_machine_owner", 200},
		{"?user_id=owner", "sk_machine_other", 403},
		{"?user_id=another", "sk_machine_owner", 403},
		{"", "sk_machine_owner", 403},
		{"?user_id=owner&user_id=owner", "sk_machine_owner", 403},
		{"?user_id=owner", "shared-token", 401},
		{"?user_id=owner", "", 401},
	} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodGet, "/daemon/managed-mcps"+tc.query, nil)
		req.Header.Set("Authorization", "Bearer "+tc.key)
		r.ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("status=%d expected=%d", w.Code, tc.status)
		}
		if w.Code == 200 {
			body := w.Body.String()
			for _, expected := range []string{"user_local", "datadream-personal", "run_sql", "127.0.0.1:28582", "cooper", "company-personal", "readContent", "getKnowledgeDirectory", "intranet-fetcher", "mcphub", "fetch_intranet", "chrome-local-confirmed"} {
				if !strings.Contains(body, expected) {
					t.Fatalf("missing catalog contract: %s", expected)
				}
			}
			for _, forbidden := range []string{"Authorization", "api_key", "sk_machine", "http_headers_helper", "create_task", "deployment_publish"} {
				if strings.Contains(body, forbidden) {
					t.Fatalf("unsafe catalog entry: %s", forbidden)
				}
			}
		}
	}
}
