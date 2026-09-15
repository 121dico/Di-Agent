package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type stationEvidenceStoreFake struct{ *stationPeopleStoreFake }

func (f *stationEvidenceStoreFake) GetReportDefinition(context.Context, string) (*model.ReportDefinition, error) {
	return &model.ReportDefinition{ID: "report", DataSourceID: "parent", Enabled: true, VisualizationJSON: json.RawMessage(`{"template":{"profile":"price_sensitive_v1_2"}}`)}, nil
}

func stationEvidenceFixture() (*ReportService, *stationEvidenceStoreFake, *reportConnectorFake) {
	_, old, connector := stationPeopleFixture()
	for _, name := range append([]string{"label_dt"}, stationEvidenceFields...) {
		old.sourceContract.Fields = append(old.sourceContract.Fields, model.ReportFieldContract{Name: name, Enabled: true, Selectable: true, Filterable: true, Sortable: true, Groupable: true})
	}
	// 不覆盖用于复购聚合的DUID既有能力。
	for i := range old.sourceContract.Fields {
		old.sourceContract.Fields[i].Aggregatable = true
	}
	store := &stationEvidenceStoreFake{old}
	runner := NewReportRunner(store, &reportRunnerStoreFake{}, connector)
	connector.results = []model.ReportQueryResult{
		{Rows: []map[string]interface{}{
			{"dt": "2026-08-01", "label_dt": "2026-08-01", "station_id": "A", "duid": json.Number("9223372036854775806"), "ps_level": "VERY_HIGH", "users": 2},
			{"dt": "2026-08-02", "label_dt": "2026-08-02", "station_id": "A", "duid": json.Number("9223372036854775806"), "ps_level": "HIGH", "users": 1},
		}, Pagination: model.ReportPagination{Total: 2}},
		{Rows: []map[string]interface{}{{"duid": json.Number("9223372036854775806"), "dt": "2026-08-02", "ps_level": "HIGH", "ps_score": 75, "price_score": 90, "coupon_score": nil, "time_score": 50, "secret": "not allowed"}}, Pagination: model.ReportPagination{Total: 1}},
	}
	return NewReportService(store, &reportServiceUserStoreFake{admin: true}, runner), store, connector
}

func TestStationScoreEvidenceUsesLastConsumptionDateAndObservedWeights(t *testing.T) {
	svc, store, connector := stationEvidenceFixture()
	got, err := svc.QueryStationScoreEvidence(context.Background(), "report", "admin", "A", "2026-08-01", "2026-08-02", "HIGH", "2")
	if err != nil {
		t.Fatal(err)
	}
	if got.CandidateCount != 1 || len(got.Cases) != 1 {
		t.Fatalf("wrong candidate size %+v", got)
	}
	c := got.Cases[0]
	if c.Status != "matched" || c.ConsumptionDays != 2 || c.Orders != 3 || c.LabelDate != "2026-08-02" || c.DUID != "9223372036854775806" {
		t.Fatalf("invalid case %+v", c)
	}
	if *c.ObservedContributions["price"] != 45 || *c.ObservedContributions["time"] != 10 || c.ObservedContributions["coupon"] != nil {
		t.Fatal("missing evidence or weights fabricated")
	}
	if _, leaked := c.Fields["secret"]; leaked {
		t.Fatal("unexpected fields exposed")
	}
	if len(store.cache) != 0 {
		t.Fatal("identities persisted to public cache")
	}
	query := string(connector.queries[1])
	if !strings.Contains(query, `"value":"2026-08-02"`) || !strings.Contains(query, `"value":"9223372036854775806"`) {
		t.Fatal("point query did not use exact same-day identity")
	}
}

func TestStationScoreEvidenceAdminAndContractGuardBeforeIdentityQuery(t *testing.T) {
	svc, store, connector := stationEvidenceFixture()
	normal := NewReportService(store, &reportServiceUserStoreFake{}, svc.runner)
	_, err := normal.QueryStationScoreEvidence(context.Background(), "report", "user", "A", "2026-08-01", "2026-08-02", "HIGH", "2")
	if !errors.Is(err, ErrReportForbidden) || len(connector.queries) != 0 {
		t.Fatal("non-admin read identity")
	}
	for _, scenario := range []string{"ALL", "revoked"} {
		station := "ALL"
		if scenario == "revoked" {
			station = "A"
			for i := range store.sourceContract.Fields {
				if store.sourceContract.Fields[i].Name == "label_dt" {
					store.sourceContract.Fields[i].Enabled = false
				}
			}
		}
		_, err := svc.QueryStationScoreEvidence(context.Background(), "report", "admin", station, "2026-08-01", "2026-08-02", "HIGH", "2")
		if !errors.Is(err, ErrReportInvalid) || len(connector.queries) != 0 {
			t.Fatalf("invalid scope queried: %s %v", scenario, err)
		}
	}
}

func TestStationScoreEvidenceUnavailableNeverUsesOtherSnapshot(t *testing.T) {
	for _, scenario := range []string{"label_date", "missing", "duplicate", "wrong_date", "wrong_level", "wrong_score", "partial"} {
		t.Run(scenario, func(t *testing.T) {
			svc, _, connector := stationEvidenceFixture()
			switch scenario {
			case "label_date":
				connector.results[0].Rows[1]["label_dt"] = "2026-08-01"
			case "missing":
				connector.results[1] = model.ReportQueryResult{}
			case "duplicate":
				connector.results[1].Pagination.Total = 2
			case "partial":
				connector.results[1].Rows = nil
			case "wrong_date":
				connector.results[1].Rows[0]["dt"] = "2026-08-03"
			case "wrong_level":
				connector.results[1].Rows[0]["ps_level"] = "VERY_HIGH"
			case "wrong_score":
				connector.results[1].Rows[0]["ps_score"] = 90
			}
			got, err := svc.QueryStationScoreEvidence(context.Background(), "report", "admin", "A", "2026-08-01", "2026-08-02", "HIGH", "2")
			if err != nil {
				t.Fatal(err)
			}
			if got.Cases[0].Status != "unavailable" || len(got.Cases[0].Fields) != 0 {
				t.Fatal("fabricated same-day explanation")
			}
			if scenario == "label_date" && len(connector.queries) != 1 {
				t.Fatal("mismatched date point queried")
			}
		})
	}
}

func TestStationScoreEvidenceRejectsIncompleteOrConflictingGroups(t *testing.T) {
	for _, scenario := range []string{"partial", "conflict", "wrong_station", "wrong_duid", "over_limit"} {
		t.Run(scenario, func(t *testing.T) {
			svc, _, connector := stationEvidenceFixture()
			switch scenario {
			case "partial":
				connector.results[0].Pagination.Total = 3
				connector.results[1] = model.ReportQueryResult{Pagination: model.ReportPagination{Total: 3}}
			case "conflict":
				connector.results[0].Rows[1]["dt"] = "2026-08-01"
			case "wrong_station":
				connector.results[0].Rows[1]["station_id"] = "B"
			case "wrong_duid":
				connector.results[0].Rows[1]["duid"] = 1.2
			case "over_limit":
				connector.results[0].Pagination.Total = 50001
			}
			_, err := svc.QueryStationScoreEvidence(context.Background(), "report", "admin", "A", "2026-08-01", "2026-08-02", "HIGH", "2")
			if !errors.Is(err, ErrReportInvalid) {
				t.Fatalf("expected rejection %v", err)
			}
		})
	}
}

func TestStationScoreEvidenceBoundsCasesAndUsesLatestLevel(t *testing.T) {
	svc, _, connector := stationEvidenceFixture()
	rows := []map[string]interface{}{}
	for i := 1; i <= 25; i++ {
		for _, date := range []string{"2026-08-01", "2026-08-02"} {
			level := "HIGH"
			if i == 25 && date == "2026-08-02" {
				level = "LOW"
			}
			// 日期不匹配时不查点表，仍保留可核查的消费案例而不伪造归因。
			rows = append(rows, map[string]interface{}{"dt": date, "label_dt": "2026-07-31", "station_id": "A", "duid": fmt.Sprint(i), "ps_level": level, "users": i})
		}
	}
	connector.results[0] = model.ReportQueryResult{Rows: rows, Pagination: model.ReportPagination{Total: 50}}
	got, err := svc.QueryStationScoreEvidence(context.Background(), "report", "admin", "A", "2026-08-01", "2026-08-02", "HIGH", "2")
	if err != nil {
		t.Fatal(err)
	}
	if got.CandidateCount != 24 || len(got.Cases) != 20 || got.Cases[0].Orders != 48 || len(connector.queries) != 1 {
		t.Fatal("bounds/latest level/order ranking invalid")
	}
}

func TestStationScoreEvidenceEmptyAndRevokedOptionalEvidence(t *testing.T) {
	svc, store, connector := stationEvidenceFixture()
	for i := range store.sourceContract.Fields {
		if store.sourceContract.Fields[i].Name == "price_score" {
			store.sourceContract.Fields[i].Enabled = false
		}
	}
	got, err := svc.QueryStationScoreEvidence(context.Background(), "report", "admin", "A", "2026-08-01", "2026-08-02", "HIGH", "2")
	if err != nil {
		t.Fatal(err)
	}
	if got.Cases[0].ObservedContributions["price"] != nil {
		t.Fatal("revoked score calculated")
	}
	if _, leaked := got.Cases[0].Fields["price_score"]; leaked {
		t.Fatal("revoked evidence exposed")
	}
	if strings.Contains(string(connector.queries[1]), `"name":"price_score"`) {
		t.Fatal("revoked field requested")
	}
	svc, _, connector = stationEvidenceFixture()
	connector.results[0] = model.ReportQueryResult{}
	got, err = svc.QueryStationScoreEvidence(context.Background(), "report", "admin", "A", "2026-08-01", "2026-08-02", "HIGH", "2")
	if err != nil || got.CandidateCount != 0 || len(got.Cases) != 0 || got.Cases == nil || len(connector.queries) != 1 {
		t.Fatal("empty cohort not represented honestly")
	}
}
