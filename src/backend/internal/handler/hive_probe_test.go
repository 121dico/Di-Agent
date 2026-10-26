package handler

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type hiveProbeUsers struct{}

func (hiveProbeUsers) GetUserByID(_ context.Context, id string) (*model.User, error) {
	return &model.User{ID: id}, nil
}

func TestHiveProbeMachineRouteRequiresTheBoundOwner(t *testing.T) {
	t.Setenv("DI_AGENT_HIVE_HOST", "")
	t.Setenv("DI_AGENT_HIVE_USER", "")
	t.Setenv("DI_AGENT_HIVE_PASSWORD", "")
	t.Setenv("DI_AGENT_HIVE_OWNER_USER_ID", "owner")
	svc := service.NewHiveDataService(hiveProbeUsers{}, nil)
	defer svc.Close()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	daemon := NewDaemonHandler(service.NewAgentService(&dataMapMachineRepo{}, nil), nil, "daemon-test-token", slog.Default(), nil, nil, nil, nil, nil)
	h := NewHiveDataHandler(svc, nil)
	r.GET("/daemon/internal-sources/hive-data/status", daemon.WithMachineBearer(h.MachineStatus))
	r.POST("/daemon/internal-sources/hive-data/probe", daemon.WithMachineBearer(h.MachineProbe))
	for _, tc := range []struct {
		name, key, requester string
		want                 int
	}{
		{"shared daemon token", "daemon-test-token", "owner", http.StatusUnauthorized},
		{"other machine spoof", "sk_machine_other", "owner", http.StatusForbidden},
		{"owner machine other requester", "sk_machine_owner", "another", http.StatusForbidden},
		{"owner machine valid requester", "sk_machine_owner", "owner", http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/daemon/internal-sources/hive-data/probe?user_id="+tc.requester,
				strings.NewReader(`{"table_name":"epower_platform.price_sensitive_v1_3","dt":"2026-10-07"}`))
			req.Header.Set("Authorization", "Bearer "+tc.key)
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
		})
	}
	req := dataMapRequest("/daemon/internal-sources/hive-data/status?user_id=owner", "sk_machine_owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"not_configured"`) {
		t.Fatalf("unconfigured owner status=%d body=%s", w.Code, w.Body.String())
	}
}
