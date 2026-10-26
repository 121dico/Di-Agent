package service

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type preparedAgentServiceStore struct {
	*reportServiceStoreFake
	catalog *preparedFake
}

func (f preparedAgentServiceStore) GetReportDataSource(_ context.Context, _ string) (*model.ReportDataSource, error) {
	return f.catalog.source, nil
}
func (f preparedAgentServiceStore) GetReportDataSourceContract(_ context.Context, _ string) (*model.ReportDataSourceContract, error) {
	return f.catalog.contract, nil
}
func (f preparedAgentServiceStore) ListEnabledReportDefinitions(_ context.Context) ([]model.ReportDefinition, error) {
	return []model.ReportDefinition{*f.catalog.report}, nil
}

type preparedAgentReceiptWriter struct {
	receipt *model.ReportAgentQueryReceipt
}

func (f *preparedAgentReceiptWriter) Create(_ context.Context, receipt *model.ReportAgentQueryReceipt) error {
	receipt.ID = "33333333-3333-4333-8333-333333333333"
	f.receipt = receipt
	return nil
}

func TestPreparedAgentQueryUsesPublicSnapshotWithoutScanningUpstream(t *testing.T) {
	catalog := &preparedFake{boundaryV12Catalog(), []model.ReportPreparedDay{preparedFixture()}, v12Contract()}
	connector := &reportConnectorFake{}
	runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
	runner.now = func() time.Time { return time.Date(2026, 9, 15, 4, 0, 0, 0, time.UTC) }
	store := preparedAgentServiceStore{&reportServiceStoreFake{}, catalog}
	svc := NewReportService(store, nil, runner)
	writer := &preparedAgentReceiptWriter{}
	svc.SetAgentReceiptStore(writer)
	result, err := svc.QueryAgentDataForUser(context.Background(), "user-1", model.ReportAgentQueryRequest{
		SourceID: "source-1", PreparedView: "v12_dashboard", Fields: []model.ReportAgentQueryField{{Name: "dt"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.QueryID != writer.receipt.ID || result.SourcePartition != "2026-09-14" || result.Rows[0]["prepared"] != true {
		t.Fatalf("unexpected prepared result: %+v", result)
	}
	var rows []map[string]any
	if err := json.Unmarshal(writer.receipt.RowsJSON, &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0]["analytics"] == nil || len(connector.queries) != 0 {
		t.Fatal("prepared receipt missing or scanned upstream")
	}
}
