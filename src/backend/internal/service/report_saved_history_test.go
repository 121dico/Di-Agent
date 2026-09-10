package service

import (
	"context"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"testing"
)

func TestReportSavedHistoryReturnsPersistedDaysWithoutUpstream(t *testing.T) {
	catalog := boundaryV12Catalog()
	catalog.cached = &model.ReportAnalyticsResult{DataDate: "2026-09-09", Trend: []model.ReportAnalyticsTrendPoint{{Date: "2026-09-09", TotalUserCount: 123}}, Summary: model.ReportAnalyticsSummary{TotalUserCount: 123}}
	connector := &reportConnectorFake{}
	result, err := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector).QueryAnalytics(context.Background(), "report-1", "saved", "2026-09-09")
	if err != nil {
		t.Fatal(err)
	}
	if result.Summary.TotalUserCount != 123 || len(result.Trend) != 1 || !result.Cached {
		t.Fatalf("lost persisted report: %+v", result)
	}
	if len(connector.queries) != 0 {
		t.Fatal("revisited report queried upstream")
	}
}
