package service

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestReportV12ExposesActualSnapshotDates(t *testing.T) {
	connector := &reportConnectorFake{result: model.ReportQueryResult{Rows: []map[string]any{{"dt": "2026-07-28"}, {"dt": "2026-09-09"}}}}
	result, err := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector).QueryAnalytics(context.Background(), "report-1", "dates", "2026-09-09")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	var decoded struct {
		Dates []string `json:"available_dates"`
	}
	json.Unmarshal(raw, &decoded)
	if len(decoded.Dates) != 2 || decoded.Dates[0] != "2026-07-28" {
		t.Fatalf("missing actual history dates: %s", raw)
	}
}

func TestReportV12HistoryPreservesUnassignedUsers(t *testing.T) {
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"dt": "2026-09-09", "total_user_count": 100}}},
		{Rows: []map[string]any{{"dt": "2026-09-09", "level": "LOW", "user_count": 80}}},
		{Rows: []map[string]any{}},
	}}
	result, err := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector).QueryAnalytics(context.Background(), "report-1", "1d", "2026-09-09")
	if err != nil {
		t.Fatal(err)
	}
	var total, unassigned int64
	for _, group := range result.Trend[0].Distribution {
		total += group.UserCount
		if group.Level == "UNASSIGNED" {
			unassigned = group.UserCount
		}
	}
	if total != 100 || unassigned != 20 {
		t.Fatalf("lost null-score users: %+v", result.Trend[0])
	}
}

func TestReportV12SnapshotTrendKeepsBothCohortsPerDate(t *testing.T) {
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"dt": "2026-09-08", "total_user_count": 100}, {"dt": "2026-09-09", "total_user_count": 110}}},
		{Rows: []map[string]any{{"dt": "2026-09-08", "level": "LOW", "user_count": 100}, {"dt": "2026-09-09", "level": "HIGH", "user_count": 110}}},
		{Rows: []map[string]any{{"dt": "2026-09-08", "level": "LOW", "user_count": 20}, {"dt": "2026-09-09", "level": "HIGH", "user_count": 30}}},
	}}
	result, err := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector).QueryAnalytics(context.Background(), "report-1", "7d", "2026-09-09")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result.Trend)
	var points []struct {
		Users        int64                               `json:"total_user_count"`
		Orders       int64                               `json:"order_user_count"`
		Distribution []model.ReportAnalyticsDistribution `json:"order_distribution"`
	}
	json.Unmarshal(raw, &points)
	if len(points) != 2 || points[0].Users != 100 || points[0].Orders != 20 || points[1].Orders != 30 || len(points[0].Distribution) != 1 {
		t.Fatalf("daily cohorts lost: %s", raw)
	}
}
