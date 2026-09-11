package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type provenanceUsers struct{}

func (provenanceUsers) GetUserByID(_ context.Context, id string) (*model.User, error) {
	return &model.User{IsAdmin: id == "admin"}, nil
}

type provenanceHTTPStore struct{ service.ReportStore }

func (provenanceHTTPStore) GetReportDefinition(context.Context, string) (*model.ReportDefinition, error) {
	return &model.ReportDefinition{ID: "report", VisualizationJSON: json.RawMessage(`{"template":{"profile":"price_sensitive_v1_2"}}`)}, nil
}

func TestReportProvenanceHTTPAdminBoundary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := NewReportHandler(service.NewReportService(provenanceHTTPStore{}, provenanceUsers{}, nil))
	for _, test := range []struct {
		user, method, path string
		status             int
	}{
		{"member", http.MethodGet, "/reports/report/provenance", 403},
		{"member", http.MethodPost, "/reports/report/provenance/replay", 403},
		{"admin", http.MethodGet, "/reports/report/provenance", 200},
	} {
		t.Run(test.user+test.method, func(t *testing.T) {
			router := gin.New()
			router.Use(func(c *gin.Context) { c.Set("user_id", test.user); c.Next() })
			router.GET("/reports/:id/provenance", handler.GetProvenance)
			router.POST("/reports/:id/provenance/replay", handler.ReplayProvenance)
			req := httptest.NewRequest(test.method, test.path, strings.NewReader(`{"execution_id":"00000000-0000-0000-0000-000000000001"}`))
			req.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			router.ServeHTTP(response, req)
			if response.Code != test.status {
				t.Fatalf("status %d: %s", response.Code, response.Body.String())
			}
			if test.status == 200 && (!strings.Contains(response.Body.String(), `"available":false`) || !strings.Contains(response.Body.String(), "无法还原当时SQL")) {
				t.Fatal("historic unavailable trace is not explicit")
			}
		})
	}
}
