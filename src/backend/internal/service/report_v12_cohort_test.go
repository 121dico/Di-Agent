package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestReportV12ConfidenceCohortUsesStrictPositiveFilter(t *testing.T) {
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"dt": "2026-09-09", "total_user_count": 100}}},
		{Rows: []map[string]any{{"dt": "2026-09-09", "level": "LOW", "user_count": 90}}},
		{Rows: []map[string]any{{"dt": "2026-09-09", "level": "HIGH", "user_count": 12}, {"dt": "2026-09-09", "level": "LOW", "user_count": 8}}},
	}}
	result, err := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector).QueryAnalytics(context.Background(), "report-1", "1d", "2026-09-09")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	var response struct {
		OrderCohort *struct {
			UserCount    int64                               `json:"user_count"`
			Share        float64                             `json:"share"`
			Distribution []model.ReportAnalyticsDistribution `json:"distribution"`
		} `json:"order_cohort"`
	}
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatal(err)
	}
	if response.OrderCohort == nil || response.OrderCohort.UserCount != 20 || response.OrderCohort.Share != 20 || len(response.OrderCohort.Distribution) != 2 {
		t.Fatalf("wrong cohort: %s", raw)
	}
	var query struct {
		Conditions []map[string]any `json:"conditionList"`
	}
	json.Unmarshal(connector.queries[2], &query)
	found := false
	for _, c := range query.Conditions {
		if c["name"] == "ps_conf" && c["operatorEnum"] == "GQ" && c["value"] == "0" {
			found = true
		}
	}
	if !found {
		t.Fatal("missing strict ps_conf > 0 predicate")
	}
}

func TestReportV12EmptyConfidenceCohortIsRealZero(t *testing.T) {
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"dt": "2026-09-09", "total_user_count": 100}}},
		{Rows: []map[string]any{{"dt": "2026-09-09", "level": "LOW", "user_count": 100}}},
		{Rows: []map[string]any{}},
	}}
	result, err := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector).QueryAnalytics(context.Background(), "report-1", "1d", "2026-09-09")
	if err != nil {
		t.Fatal(err)
	}
	if result.OrderCohort == nil || result.OrderCohort.UserCount != 0 || result.OrderCohort.Share != 0 || len(result.OrderCohort.Distribution) != 0 {
		t.Fatalf("wrong empty cohort: %+v", result.OrderCohort)
	}
}

func TestReportV12TruncatedConfidenceCohortIsNotCached(t *testing.T) {
	catalog := boundaryV12Catalog()
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"dt": "2026-09-09", "total_user_count": 100}}},
		{Rows: []map[string]any{}},
		{Rows: []map[string]any{{"dt": "2026-09-09", "level": "HIGH", "user_count": 12}}, Pagination: model.ReportPagination{Total: 2, PageCount: 2}},
	}}
	result, err := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector).QueryAnalytics(context.Background(), "report-1", "1d", "2026-09-09")
	if err == nil || result != nil || catalog.cached != nil {
		t.Fatal("partial confidence distribution was accepted")
	}
}
