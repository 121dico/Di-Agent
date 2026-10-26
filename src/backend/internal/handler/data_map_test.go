package handler

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type dataMapMachineRepo struct{ service.AgentRepo }

func (r *dataMapMachineRepo) GetDaemonMachineByAPIKeyHash(_ context.Context, hash string) (*model.DaemonMachine, error) {
	for _, entry := range []struct{ key, user string }{{"sk_machine_owner", "owner"}, {"sk_machine_other", "another"}} {
		sum := sha256.Sum256([]byte(entry.key))
		if hash == hex.EncodeToString(sum[:]) {
			return &model.DaemonMachine{ID: entry.key, UserID: entry.user}, nil
		}
	}
	return nil, nil
}

func dataMapTestRouter(svc *service.DataMapService) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	agentSvc := service.NewAgentService(&dataMapMachineRepo{}, nil)
	daemon := NewDaemonHandler(agentSvc, nil, "daemon-test-token", slog.Default(), nil, nil, nil, nil, nil)
	h := NewDataMapHandler(svc)
	r.GET("/daemon/internal-sources/status", daemon.WithMachineBearer(h.Status))
	r.GET("/daemon/internal-sources/data-map/hive/tables", daemon.WithMachineBearer(h.SearchHiveTables))
	return r
}

func dataMapRequest(path, machineKey string) *http.Request {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	req.Header.Set("Authorization", "Bearer "+machineKey)
	return req
}

func TestDataMapHandlerSignedTableSearchReturnsOnlyMetadata(t *testing.T) {
	const timestamp = "1535528202000"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/dp_metadata_api/hive/table/pageByPrefix" || r.URL.Query().Get("dbName") != "epower_platform" || r.URL.Query().Get("prefix") != "price_sensitive" || r.URL.Query().Get("pageNo") != "1" || r.URL.Query().Get("pageSize") != "10" {
			t.Errorf("unexpected upstream request: %s", r.URL.String())
		}
		if r.Header.Get("client") != "pilot-client" || r.Header.Get("timeStamp") != timestamp || r.Header.Get("sign") != "a1a24239aabb193f11e5fae8429d7663" {
			t.Errorf("unexpected signed headers: client=%q timestamp=%q sign=%q", r.Header.Get("client"), r.Header.Get("timeStamp"), r.Header.Get("sign"))
		}
		if strings.Contains(r.URL.String(), "my-token") {
			t.Error("credential leaked into request URL")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"meta":{"code":0},"data":{"list":[{"dbName":"epower_platform","tableName":"price_sensitive_v1_3","sampleRows":[{"duid":"PRIVATE"}],"owner":"PRIVATE"}]}}`))
	}))
	defer upstream.Close()
	svc := service.NewDataMapService(service.DataMapConfig{BaseURL: upstream.URL, ClientID: "pilot-client", Token: "my-token", OwnerUserID: "owner"}, upstream.Client(), func() time.Time { return time.UnixMilli(1535528202000) })
	r := dataMapTestRouter(svc)
	req := dataMapRequest("/daemon/internal-sources/data-map/hive/tables?user_id=owner&db_name=epower_platform&prefix=price_sensitive&page_no=1&page_size=10", "sk_machine_owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var response struct {
		Data struct {
			Source string `json:"source"`
			Tables []struct {
				DBName    string `json:"db_name"`
				TableName string `json:"table_name"`
			} `json:"tables"`
		} `json:"data"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Data.Source != "data_map" || len(response.Data.Tables) != 1 || response.Data.Tables[0].TableName != "price_sensitive_v1_3" {
		t.Fatalf("unexpected sanitized result: %+v", response.Data)
	}
	if strings.Contains(w.Body.String(), "PRIVATE") || strings.Contains(w.Body.String(), "my-token") || strings.Contains(w.Body.String(), "sampleRows") {
		t.Fatalf("private upstream content leaked: %s", w.Body.String())
	}
	statusReq := dataMapRequest("/daemon/internal-sources/status?user_id=owner", "sk_machine_owner")
	status := httptest.NewRecorder()
	r.ServeHTTP(status, statusReq)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"connected"`) {
		t.Fatalf("verified metadata status=%d body=%s", status.Code, status.Body.String())
	}
}

func TestDataMapHandlerFailsClosedWithoutConfigurationOrOwner(t *testing.T) {
	svc := service.NewDataMapService(service.DataMapConfig{}, http.DefaultClient, time.Now)
	r := dataMapTestRouter(svc)
	req := dataMapRequest("/daemon/internal-sources/status?user_id=owner", "sk_machine_owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"not_configured"`) {
		t.Fatalf("unconfigured status=%d body=%s", w.Code, w.Body.String())
	}
	req = dataMapRequest("/daemon/internal-sources/data-map/hive/tables?user_id=owner&prefix=price", "sk_machine_owner")
	w = httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable || strings.Contains(w.Body.String(), "未找到") {
		t.Fatalf("unconfigured query must fail closed, status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestDataMapHandlerBindsPilotToAuthenticatedMachineOwner(t *testing.T) {
	calls := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls++
		_, _ = w.Write([]byte(`{"meta":{"code":0},"data":{"list":[]}}`))
	}))
	defer upstream.Close()
	svc := service.NewDataMapService(service.DataMapConfig{BaseURL: upstream.URL, ClientID: "pilot", Token: "test-only", OwnerUserID: "owner"}, upstream.Client(), time.Now)
	r := dataMapTestRouter(svc)
	for _, tc := range []struct {
		name, path, key string
		want            int
	}{
		{"retired mcp route", "/mcp/internal-sources/data-map/hive/tables?user_id=owner&prefix=price", "daemon-test-token", http.StatusNotFound},
		{"shared daemon token spoof", "/daemon/internal-sources/data-map/hive/tables?user_id=owner&prefix=price", "daemon-test-token", http.StatusUnauthorized},
		{"other machine spoof", "/daemon/internal-sources/data-map/hive/tables?user_id=owner&prefix=price", "sk_machine_other", http.StatusForbidden},
		{"owner machine other requester", "/daemon/internal-sources/data-map/hive/tables?user_id=another&prefix=price", "sk_machine_owner", http.StatusForbidden},
		{"owner machine missing requester", "/daemon/internal-sources/data-map/hive/tables?prefix=price", "sk_machine_owner", http.StatusForbidden},
		{"owner machine matching requester", "/daemon/internal-sources/data-map/hive/tables?user_id=owner&prefix=price", "sk_machine_owner", http.StatusOK},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := dataMapRequest(tc.path, tc.key)
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("status=%d want=%d body=%s", w.Code, tc.want, w.Body.String())
			}
		})
	}
	if calls != 1 {
		t.Fatalf("unauthorized requests reached Data Map upstream: %d", calls)
	}
}

func TestDataMapHandlerRejectsUnknownSuccessPayloadAndOtherUsers(t *testing.T) {
	called := 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called++
		_, _ = w.Write([]byte(`{"meta":{"code":0},"data":{"unexpected":[]}}`))
	}))
	defer upstream.Close()
	svc := service.NewDataMapService(service.DataMapConfig{BaseURL: upstream.URL, ClientID: "pilot-client", Token: "pilot-token", OwnerUserID: "owner"}, upstream.Client(), time.Now)
	r := dataMapTestRouter(svc)
	for _, tc := range []struct {
		user string
		want int
	}{{"another", http.StatusForbidden}, {"owner", http.StatusBadGateway}} {
		key := "sk_machine_owner"
		if tc.user != "owner" {
			key = "sk_machine_other"
		}
		req := dataMapRequest("/daemon/internal-sources/data-map/hive/tables?user_id="+tc.user+"&prefix=price", key)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.want || strings.Contains(w.Body.String(), `"tables":[]`) {
			t.Fatalf("user=%s status=%d body=%s", tc.user, w.Code, w.Body.String())
		}
	}
	if called != 1 {
		t.Fatalf("unbound user reached upstream; calls=%d", called)
	}
	statusReq := dataMapRequest("/daemon/internal-sources/status?user_id=owner", "sk_machine_owner")
	status := httptest.NewRecorder()
	r.ServeHTTP(status, statusReq)
	if status.Code != http.StatusOK || !strings.Contains(status.Body.String(), `"temporarily_unavailable"`) {
		t.Fatalf("unverified response status=%d body=%s", status.Code, status.Body.String())
	}
}

func TestDataMapHandlerDoesNotForwardCredentialsAcrossRedirects(t *testing.T) {
	redirected := 0
	destination := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected++
		if r.Header.Get("client") != "" || r.Header.Get("sign") != "" {
			t.Error("Data Map credentials reached redirect destination")
		}
		_, _ = w.Write([]byte(`{"meta":{"code":0},"data":{"list":[]}}`))
	}))
	defer destination.Close()
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destination.URL, http.StatusFound)
	}))
	defer upstream.Close()
	svc := service.NewDataMapService(service.DataMapConfig{BaseURL: upstream.URL, ClientID: "pilot-client", Token: "pilot-token", OwnerUserID: "owner"}, upstream.Client(), time.Now)
	r := dataMapTestRouter(svc)
	req := dataMapRequest("/daemon/internal-sources/data-map/hive/tables?user_id=owner&prefix=price", "sk_machine_owner")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusServiceUnavailable || redirected != 0 {
		t.Fatalf("redirect must not be followed, status=%d redirected=%d body=%s", w.Code, redirected, w.Body.String())
	}
}
