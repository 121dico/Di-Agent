package service

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type sourceTimeStoreFake struct {
	reportServiceStoreFake
	saved *model.ReportSourceTimeCoverage
}

func TestSourceTimeCoverageEmptyGroups(t *testing.T) {
	for _, pageCount := range []int{0, 1} {
		st := &sourceTimeStoreFake{}
		st.sourceContract = &model.ReportDataSourceContract{Enabled: true, Fields: []model.ReportFieldContract{{Name: "dt", Enabled: true, Selectable: true, Groupable: true, Sortable: true}}}
		c := &reportConnectorFake{result: model.ReportQueryResult{Pagination: model.ReportPagination{Page: 1, PageSize: 1000, PageCount: pageCount}}}
		s := NewReportService(st, &reportServiceUserStoreFake{admin: true}, NewReportRunner(st, &reportRunnerStoreFake{}, c))
		v, e := s.SourceTimeCoverage(context.Background(), "admin", "source-1", true)
		if e != nil || v.Status != "verified" || v.Partition == nil || !v.Partition.Empty {
			t.Fatalf("pageCount %d: %+v %v", pageCount, v, e)
		}
	}
}

func TestSourceTimeCoverageMultipleGroupPagesAndBusinessScope(t *testing.T) {
	for _, changedTotal := range []bool{false, true} {
		st := &sourceTimeStoreFake{}
		st.sourceContract = &model.ReportDataSourceContract{Enabled: true, Fields: []model.ReportFieldContract{{Name: "dt", Enabled: true, Selectable: true, Groupable: true, Sortable: true, Filterable: true}, {Name: "order_date", Enabled: true, Selectable: true, Groupable: true, Sortable: true}}}
		start, _ := time.Parse("2006-01-02", "2023-01-01")
		rows := make([]map[string]any, 1000)
		for i := range rows {
			rows[i] = map[string]any{"dt": start.AddDate(0, 0, i).Format("2006-01-02")}
		}
		last := start.AddDate(0, 0, 1000).Format("2006-01-02")
		total := 1001
		if changedTotal {
			total = 1002
		}
		c := &reportConnectorFake{results: []model.ReportQueryResult{
			{Rows: rows, Partition: "2099-01-01", Pagination: model.ReportPagination{Total: 1001, Page: 1, PageSize: 1000, PageCount: 2}},
			{Rows: []map[string]any{{"dt": last}}, Pagination: model.ReportPagination{Total: int64(total), Page: 2, PageSize: 1000, PageCount: 2}},
			{Rows: []map[string]any{{"order_date": "2022-01-18"}, {"order_date": last}}, Pagination: model.ReportPagination{Total: 2, Page: 1, PageSize: 1000, PageCount: 1}},
		}}
		s := NewReportService(st, &reportServiceUserStoreFake{admin: true}, NewReportRunner(st, &reportRunnerStoreFake{}, c))
		v, e := s.SourceTimeCoverage(context.Background(), "admin", "source-1", true)
		if e != nil {
			t.Fatal(e)
		}
		if changedTotal {
			if v.Status != "failed" || v.Partition != nil || len(c.queries) != 2 {
				t.Fatalf("partial accepted: %+v", v)
			}
			continue
		}
		if v.Status != "verified" || *v.Partition.End != last || v.Business.Partition != last || *v.Business.Start != "2022-01-18" {
			t.Fatalf("coverage: %+v", v)
		}
		var q map[string]any
		_ = json.Unmarshal(c.queries[2], &q)
		condition := q["conditionList"].([]any)[0].(map[string]any)
		if condition["value"] != last {
			t.Fatalf("business used hint: %v", q)
		}
	}
}

func TestSourceTimeCoverageGroupedFallbackAndMalformed(t *testing.T) {
	for _, malformed := range []bool{false, true} {
		t.Run(map[bool]string{false: "complete", true: "duplicate"}[malformed], func(t *testing.T) {
			st := &sourceTimeStoreFake{}
			st.sourceContract = &model.ReportDataSourceContract{Enabled: true, Fields: []model.ReportFieldContract{{Name: "dt", Enabled: true, Selectable: true, Groupable: true, Sortable: true}}}
			rows := []map[string]any{{"dt": "2026-08-12"}, {"dt": "2026-09-14"}}
			if malformed {
				rows[1]["dt"] = "2026-08-12"
			}
			c := &reportConnectorFake{result: model.ReportQueryResult{Rows: rows, Pagination: model.ReportPagination{Total: 2, Page: 1, PageSize: 1000, PageCount: 1}}}
			s := NewReportService(st, &reportServiceUserStoreFake{admin: true}, NewReportRunner(st, &reportRunnerStoreFake{}, c))
			v, e := s.SourceTimeCoverage(context.Background(), "admin", "source-1", true)
			if e != nil {
				t.Fatal(e)
			}
			if malformed {
				if v.Status != "failed" || v.Partition != nil {
					t.Fatalf("must not save partial: %+v", v)
				}
			} else if v.Status != "verified" || *v.Partition.End != "2026-09-14" {
				t.Fatalf("fallback: %+v", v)
			}
			var q map[string]any
			_ = json.Unmarshal(c.query, &q)
			if q["groupList"] == nil {
				t.Fatal("missing group contract")
			}
		})
	}
}

func TestSourceTimeCoverageBusyAndDateValidation(t *testing.T) {
	st := &sourceTimeStoreFake{}
	s := NewReportService(st, &reportServiceUserStoreFake{admin: true}, nil)
	s.sourceTimeMu.Lock()
	_, err := s.SourceTimeCoverage(context.Background(), "admin", "source-1", true)
	s.sourceTimeMu.Unlock()
	if !errors.Is(err, ErrReportSourceTimeBusy) {
		t.Fatal(err)
	}
	for _, row := range []map[string]any{{}, {"start": "2026-02-30"}, {"start": 123}, {"start": "20260914"}} {
		if _, err := sourceTimeDate(row, "start"); err == nil {
			t.Fatalf("accepted malformed date %v", row)
		}
	}
	if value, err := sourceTimeDate(map[string]any{"start": nil}, "start"); err != nil || value != nil {
		t.Fatalf("null: %v %v", value, err)
	}
}

func TestSourceTimeCoverageNullAndRevokedContract(t *testing.T) {
	st := &sourceTimeStoreFake{}
	st.sourceContract = &model.ReportDataSourceContract{Enabled: true, Fields: []model.ReportFieldContract{{Name: "dt", Enabled: true, Selectable: true, Aggregatable: true}}}
	c := &reportConnectorFake{result: model.ReportQueryResult{Rows: []map[string]any{{"start": nil, "end": nil}}}}
	s := NewReportService(st, &reportServiceUserStoreFake{admin: true}, NewReportRunner(st, &reportRunnerStoreFake{}, c))
	v, err := s.SourceTimeCoverage(context.Background(), "admin", "source-1", true)
	if err != nil || v.Status != "verified" || !v.Partition.Empty || v.Partition.Start != nil {
		t.Fatalf("empty result: %+v %v", v, err)
	}
	fingerprint := v.Fingerprint
	st.sourceContract.Fields[0].Enabled = false
	v, err = s.SourceTimeCoverage(context.Background(), "admin", "source-1", true)
	if err != nil || v.Status != "stale" || v.Partition == nil || v.Fingerprint != fingerprint || len(c.queries) != 1 {
		t.Fatalf("revocation: %+v %v, queries %d", v, err, len(c.queries))
	}
}

func (f *sourceTimeStoreFake) GetSourceTimeCoverage(context.Context, string) (*model.ReportSourceTimeCoverage, error) {
	if f.saved == nil {
		return nil, nil
	}
	b, _ := json.Marshal(f.saved)
	var v model.ReportSourceTimeCoverage
	_ = json.Unmarshal(b, &v)
	return &v, nil
}
func (f *sourceTimeStoreFake) SaveSourceTimeCoverage(_ context.Context, v *model.ReportSourceTimeCoverage) error {
	b, _ := json.Marshal(v)
	f.saved = &model.ReportSourceTimeCoverage{}
	return json.Unmarshal(b, f.saved)
}
func TestSourceTimeCoverageCacheRefreshAndFailure(t *testing.T) {
	st := &sourceTimeStoreFake{}
	st.sourceContract = &model.ReportDataSourceContract{Enabled: true, Fields: []model.ReportFieldContract{{Name: "dt", Enabled: true, Selectable: true, Aggregatable: true, Filterable: true}, {Name: "order_date", Enabled: true, Selectable: true, Aggregatable: true}}}
	c := &reportConnectorFake{results: []model.ReportQueryResult{{Rows: []map[string]any{{"start": "2026-07-28", "end": "2026-09-14"}}}, {Rows: []map[string]any{{"start": "2022-01-18", "end": "2026-09-14"}}}}}
	s := NewReportService(st, &reportServiceUserStoreFake{admin: true}, NewReportRunner(st, &reportRunnerStoreFake{}, c))
	v, e := s.SourceTimeCoverage(context.Background(), "admin", "source-1", false)
	if e != nil || v.Status != "unchecked" || len(c.queries) != 0 {
		t.Fatalf("cache read: %+v %v", v, e)
	}
	v, e = s.SourceTimeCoverage(context.Background(), "admin", "source-1", true)
	if e != nil || v.Status != "verified" || *v.Partition.Start != "2026-07-28" || v.Business.Partition != "2026-09-14" {
		t.Fatalf("refresh: %+v %v", v, e)
	}
	c.err = errors.New("secret upstream detail")
	v, e = s.SourceTimeCoverage(context.Background(), "admin", "source-1", true)
	if e != nil || v.Status != "failed" || v.CheckedAt == nil || v.Error == c.err.Error() {
		t.Fatalf("failure retention: %+v %v", v, e)
	}
	st.sourceContract.Fields[0].Enabled = false
	v, e = s.SourceTimeCoverage(context.Background(), "admin", "source-1", false)
	if e != nil || v.Status != "stale" {
		t.Fatalf("stale: %+v %v", v, e)
	}
	s.users = &reportServiceUserStoreFake{}
	_, e = s.SourceTimeCoverage(context.Background(), "user", "source-1", false)
	if !errors.Is(e, ErrReportForbidden) {
		t.Fatalf("permission: %v", e)
	}
}
