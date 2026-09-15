package service

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"sync/atomic"
	"testing"
	"time"
)

type parallelPreparedConnector struct {
	entered chan struct{}
	release chan struct{}
	active  atomic.Int32
	peak    atomic.Int32
}

func (f *parallelPreparedConnector) Query(ctx context.Context, _ model.ReportDataSource, raw []byte) (model.ReportQueryResult, error) {
	var q map[string]any
	_ = json.Unmarshal(raw, &q)
	if len(q["fieldList"].([]any)) == 1 {
		rows := []map[string]any{}
		for _, date := range []string{"2026-09-14", "2026-09-13", "2026-09-12", "2026-09-11", "2026-09-10", "2026-09-09"} {
			rows = append(rows, map[string]any{"dt": date})
		}
		return model.ReportQueryResult{Rows: rows}, nil
	}
	n := f.active.Add(1)
	defer f.active.Add(-1)
	for old := f.peak.Load(); n > old; old = f.peak.Load() {
		if f.peak.CompareAndSwap(old, n) {
			break
		}
	}
	f.entered <- struct{}{}
	select {
	case <-f.release:
	case <-ctx.Done():
	}
	return model.ReportQueryResult{}, errors.New("injected upstream failure")
}

type parallelRunStore struct{ done chan struct{} }

func (f *parallelRunStore) StartReportRun(context.Context, *model.ReportRun) error { return nil }
func (f *parallelRunStore) CompleteReportRun(context.Context, *model.ReportRun) error {
	close(f.done)
	return nil
}
func (f *parallelRunStore) FailReportRun(context.Context, *model.ReportRun) error {
	close(f.done)
	return nil
}

func TestPreparedRunUsesBoundedParallelRequests(t *testing.T) {
	catalog := &preparedFake{boundaryV12Catalog(), nil, v12Contract()}
	connector := &parallelPreparedConnector{entered: make(chan struct{}, 10), release: make(chan struct{})}
	store := &parallelRunStore{done: make(chan struct{})}
	runner := NewReportRunner(catalog, store, connector)
	runner.now = func() time.Time { return time.Date(2026, 9, 15, 12, 0, 0, 0, time.UTC) }
	_, err := runner.Run(context.Background(), "report-1", "startup", "")
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		close(connector.release)
		select {
		case <-store.done:
		case <-time.After(time.Second):
			t.Error("run did not finish")
		}
	}()
	for i := 0; i < 2; i++ {
		select {
		case <-connector.entered:
		case <-time.After(time.Second):
			t.Fatal("history still serial: two independent dates did not start")
		}
	}
	select {
	case <-connector.entered:
		t.Fatal("more than two upstream requests")
	case <-time.After(30 * time.Millisecond):
	}
	if connector.peak.Load() != 2 {
		t.Fatalf("peak = %d", connector.peak.Load())
	}
}

func TestPreparedLargePageRequiresCompleteMetadata(t *testing.T) {
	for _, tc := range []struct {
		name       string
		pagination model.ReportPagination
		wantErr    bool
	}{
		{"missing total", model.ReportPagination{}, true},
		{"clamped size", model.ReportPagination{Total: 1, PageSize: 1000}, true},
		{"complete", model.ReportPagination{Total: 1, PageSize: 10000}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			catalog := boundaryV12Catalog()
			connector := &reportConnectorFake{result: model.ReportQueryResult{Rows: []map[string]any{{"dt": "2026-09-14", "city": "北京", "total_user_count": 100, "total_order_count": 200}}, Pagination: tc.pagination}}
			runner := NewReportRunner(catalog, &reportRunnerStoreFake{}, connector)
			queries, keys, err := buildV12AggregateQueries(catalog.report, &model.ReportAnalyticsResult{StartDate: "2026-09-14", EndDate: "2026-09-14"}, nil)
			if err != nil {
				t.Fatal(err)
			}
			_, _, err = runner.preparedRows(context.Background(), catalog.report, catalog.source, v12Contract(), "2026-09-14", keys[0], preparedCityQuery(queries[0]))
			if (err != nil) != tc.wantErr {
				t.Fatalf("error=%v", err)
			}
		})
	}
}
