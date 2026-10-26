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

type hiveMachineRepo struct{ service.AgentRepo }

func (*hiveMachineRepo) GetDaemonMachineByAPIKeyHash(_ context.Context, hash string) (*model.DaemonMachine, error) {
	for _, item := range []struct{ key, user string }{{"sk_machine_owner", "owner"}, {"sk_machine_other", "other"}} {
		sum := sha256.Sum256([]byte(item.key))
		if hash == hex.EncodeToString(sum[:]) {
			return &model.DaemonMachine{UserID: item.user}, nil
		}
	}
	return nil, nil
}

type hiveMachineUsers struct{}

func (hiveMachineUsers) GetUserByID(_ context.Context, id string) (*model.User, error) {
	return &model.User{ID: id}, nil
}

func TestHiveProbeMachineRouteCannotBorrowAnotherUser(t *testing.T) {
	t.Setenv("DI_AGENT_HIVE_HOST", "")
	t.Setenv("DI_AGENT_HIVE_OWNER_USER_ID", "owner")
	svc := service.NewHiveDataService(hiveMachineUsers{}, nil)
	defer svc.Close()
	gin.SetMode(gin.TestMode)
	r := gin.New()
	daemon := NewDaemonHandler(service.NewAgentService(&hiveMachineRepo{}, nil), nil, "shared-daemon-token", slog.Default(), nil, nil, nil, nil, nil)
	h := NewHiveDataHandler(svc, nil)
	r.POST("/probe", daemon.WithMachineBearer(h.MachineProbe))
	for _, tc := range []struct {
		name, key, requester string
		want                 int
	}{
		{"shared token", "shared-daemon-token", "owner", http.StatusUnauthorized},
		{"other machine", "sk_machine_other", "owner", http.StatusForbidden},
		{"owner spoof", "sk_machine_owner", "other", http.StatusForbidden},
		{"owner no Hive session", "sk_machine_owner", "owner", http.StatusServiceUnavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodPost, "/probe?user_id="+tc.requester, strings.NewReader(`{"table_name":"epower_platform.price_sensitive_v1_3","dt":"2026-10-07"}`))
			req.Header.Set("Authorization", "Bearer "+tc.key)
			req.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
		})
	}
}
