package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/gin-gonic/gin"
)

type agentQueryStore struct{ service.ReportStore }

func (agentQueryStore) GetReportDataSource(context.Context, string) (*model.ReportDataSource, error) {
	return &model.ReportDataSource{ID: "source-1", APIName: "example", Enabled: true}, nil
}

func (agentQueryStore) GetReportDataSourceContract(context.Context, string) (*model.ReportDataSourceContract, error) {
	return &model.ReportDataSourceContract{SourceID: "source-1", Name: "example", Enabled: true,
		Fields: []model.ReportFieldContract{{Name: "dt", Enabled: true, Selectable: true, Groupable: true, Sortable: true}}}, nil
}

type agentQueryConnector struct{}

func (agentQueryConnector) Query(context.Context, model.ReportDataSource, []byte) (model.ReportQueryResult, error) {
	return model.ReportQueryResult{Rows: []map[string]any{{"dt": "2026-09-16"}},
		Pagination: model.ReportPagination{Total: 1, Page: 1, PageSize: 100, PageCount: 1}, QueryID: "upstream-query"}, nil
}

func TestMCPReportQueryWithoutUserUsesServiceQuery(t *testing.T) {
	gin.SetMode(gin.TestMode)
	store := agentQueryStore{}
	svc := service.NewReportService(store, nil, service.NewReportRunner(store, nil, agentQueryConnector{}))
	router := gin.New()
	router.POST("/mcp/report-data/query", NewReportHandler(svc).QueryAgentData)
	request := httptest.NewRequest(http.MethodPost, "/mcp/report-data/query",
		strings.NewReader(`{"source_id":"source-1","fields":[{"name":"dt"}],"group_by":["dt"],"order_by":"dt"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	if response.Code != http.StatusOK || !strings.Contains(response.Body.String(), "upstream-query") {
		t.Fatalf("service-token query should return upstream aggregate without a user receipt: %d %s", response.Code, response.Body.String())
	}
}
