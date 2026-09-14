package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestOrderCountCohortUsesRealOrdersAndDistinctPopulation(t *testing.T) {
	connector := &reportConnectorFake{results: []model.ReportQueryResult{
		{Rows: []map[string]any{{"dt": "2026-09-13", "level": "HIGH", "user_count": 3}, {"dt": "2026-09-13", "level": "LOW", "user_count": 7}}},
		{Rows: []map[string]any{{"dt": "2026-09-13", "user_count": 10}}},
	}}
	runner := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector)
	result, err := runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "gt10", []string{"北京"})
	if err != nil {
		t.Fatal(err)
	}
	if result.OrderCohort == nil || result.OrderCohort.UserCount != 10 || len(result.OrderCohort.Distribution) != 2 {
		t.Fatalf("wrong population: %+v", result)
	}
	for _, raw := range connector.queries {
		var q struct {
			Conditions []map[string]any `json:"conditionList"`
			Fields     []map[string]any `json:"fieldList"`
		}
		if err := json.Unmarshal(raw, &q); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, c := range q.Conditions {
			if c["name"] == "order_cnt_180d" && c["operatorEnum"] == "GQ" && c["value"] == "10" {
				found = true
			}
			if c["name"] == "ps_order_cnt" {
				t.Fatal("capped order count used")
			}
		}
		if !found {
			t.Fatal("missing >10 orders filter")
		}
		for _, f := range q.Fields {
			if f["name"] == "duid" && f["aggFunctionEnum"] != "COUNT_DISTINCT" {
				t.Fatal("population not deduplicated")
			}
		}
	}
}

type orderCountCatalog struct {
	*v12CatalogFake
	contract *model.ReportDataSourceContract
	entries  map[string]*model.ReportAnalyticsResult
}

func (f *orderCountCatalog) GetReportDataSourceContract(context.Context, string) (*model.ReportDataSourceContract, error) {
	return f.contract, nil
}
func (f *orderCountCatalog) GetTemplateAnalytics(_ context.Context, key string, _ time.Time) (*model.ReportAnalyticsResult, error) {
	return f.entries[key], nil
}
func (f *orderCountCatalog) SaveTemplateAnalytics(_ context.Context, key, _ string, value *model.ReportAnalyticsResult, _ time.Time) error {
	f.entries[key] = value
	return nil
}

func TestOrderCountCohortCacheScopeAndContractRevocation(t *testing.T) {
	catalog := &orderCountCatalog{boundaryV12Catalog(), v12Contract(), map[string]*model.ReportAnalyticsResult{}}
	connector := &reportConnectorFake{result: model.ReportQueryResult{Rows: []map[string]any{{"dt": "2026-09-13", "level": "HIGH", "user_count": 4}}}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	for _, selection := range []string{"10", "10", "gt10"} {
		if _, err := runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-13", selection, nil); err != nil {
			t.Fatal(err)
		}
	}
	if len(connector.queries) != 4 {
		t.Fatal("cached selection rescanned or different selection reused wrong cache")
	}
	for i := range catalog.contract.Fields {
		if catalog.contract.Fields[i].Name == "order_cnt_180d" {
			catalog.contract.Fields[i].Filterable = false
		}
	}
	if _, err := runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "10", nil); err == nil {
		t.Fatal("revoked field bypassed through cache")
	}
}

func TestOrderCountCohortRejectsBadCountsAndPartialResults(t *testing.T) {
	for _, rows := range [][]map[string]any{
		{{"dt": "2026-09-13", "level": "HIGH", "user_count": -1}},
		{{"dt": "2026-09-12", "level": "HIGH", "user_count": 4}},
		{{"dt": "2026-09-13", "level": "HIGH", "user_count": 3}},
		{{"dt": "2026-09-13", "level": "HIGH", "user_count": 2}, {"dt": "2026-09-13", "level": "HIGH", "user_count": 2}},
	} {
		catalog := boundaryV12Catalog()
		connector := &reportConnectorFake{results: []model.ReportQueryResult{{Rows: rows}, {Rows: []map[string]any{{"dt": "2026-09-13", "user_count": 4}}}}}
		if _, err := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector).QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "1", nil); err == nil || catalog.cached != nil {
			t.Fatal("invalid population accepted/cached")
		}
	}
}

func TestOrderCountCohortDistinguishesEmptyCohortFromMissingSnapshot(t *testing.T) {
	for _, exists := range []bool{true, false} {
		var rows []map[string]any
		if exists {
			rows = []map[string]any{{"dt": "2026-09-13"}}
		}
		connector := &reportConnectorFake{results: []model.ReportQueryResult{{}, {}, {Rows: rows}}}
		result, err := NewReportRunner(boundaryV12Catalog(), &reportRunnerStoreFake{}, connector).QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "1", nil)
		if exists && (err != nil || result.OrderCohort.UserCount != 0) {
			t.Fatalf("real zero rejected: %v", err)
		}
		if !exists && err == nil {
			t.Fatal("missing snapshot shown as zero people")
		}
	}
}
