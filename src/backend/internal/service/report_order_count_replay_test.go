package service

import (
	"bytes"
	"context"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestOrderCountProvenanceCanReplayTrustedSelection(t *testing.T) {
	catalog := &provenanceCatalogFake{v12CatalogFake: boundaryV12Catalog()}
	connector := &reportConnectorFake{result: model.ReportQueryResult{Rows: []map[string]any{{"dt": "2026-09-13", "level": "HIGH", "user_count": 4}}}}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	if _, err := runner.QueryOrderCohort(context.Background(), "report-1", "2026-09-13", "gt10", nil); err != nil {
		t.Fatal(err)
	}
	svc := NewReportService(&provenanceServiceStoreFake{catalog: catalog}, &reportServiceUserStoreFake{admin: true}, runner)
	for _, saved := range append([]model.ReportQueryExecution{}, catalog.executions...) {
		result, err := svc.ReplayProvenance(context.Background(), "report-1", "admin", saved.ID)
		if err != nil || result == nil || !result.ReplayOnly {
			t.Fatalf("trusted order cohort not replayable: %v", err)
		}
	}
	catalog.executions[0].RequestJSON = bytes.ReplaceAll(catalog.executions[0].RequestJSON, []byte("COUNT_DISTINCT"), []byte("COUNT"))
	before := len(connector.queries)
	if _, err := svc.ReplayProvenance(context.Background(), "report-1", "admin", catalog.executions[0].ID); err == nil || len(connector.queries) != before {
		t.Fatal("tampered aggregation was replayed")
	}
}
