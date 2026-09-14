package service

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestBuildStationPeopleDistinguishesReplacementFromRepeat(t *testing.T) {
	rows := []StationPersonObservation{
		{Date: "2026-08-01", Station: "A", DUID: "1", Level: "VERY_HIGH", Orders: 2},
		{Date: "2026-08-02", Station: "A", DUID: "1", Level: "HIGH", Orders: 1},
		{Date: "2026-08-02", Station: "B", DUID: "1", Level: "HIGH", Orders: 1},
		{Date: "2026-08-02", Station: "A", DUID: "2", Level: "VERY_HIGH", Orders: 1},
	}
	result, err := BuildStationPeople(rows, []string{"2026-08-01", "2026-08-02"}, "ALL", "2026-08-01", "2026-08-02")
	if err != nil {
		t.Fatal(err)
	}
	if result.Users != 2 || result.RepeatUsers != 1 || result.MultiDayUsers != 1 || result.CrossStationUsers != 1 {
		t.Fatalf("unexpected summary: %+v", result)
	}
	if result.Days[1].Returning != 1 || result.Days[1].New != 1 || result.Days[1].Previous != 1 {
		t.Fatalf("replacement hidden: %+v", result.Days[1])
	}
	if result.Levels["HIGH"].ThreePlus != 1 || result.Levels["VERY_HIGH"].Once != 1 {
		t.Fatalf("latest labels: %+v", result.Levels)
	}
}

func TestBuildStationPeopleUsesHistoryBeforeRangeWithoutCountingItsOrders(t *testing.T) {
	rows := []StationPersonObservation{
		{Date: "2026-08-01", Station: "A", DUID: "1", Level: "VERY_HIGH", Orders: 2},
		{Date: "2026-08-03", Station: "A", DUID: "1", Level: "LOW", Orders: 1},
	}
	result, err := BuildStationPeople(rows, []string{"2026-08-01", "2026-08-03"}, "A", "2026-08-03", "2026-08-03")
	if err != nil {
		t.Fatal(err)
	}
	if result.RepeatUsers != 0 || result.Days[0].Returning != 1 || result.Days[0].Previous != 0 || result.Days[0].PreviousWeek != 1 || result.Levels["LOW"].Once != 1 {
		t.Fatalf("range/history mixed: %+v", result)
	}
	if result.Days[0].Levels["LOW"].SameLevelWeek != 0 {
		t.Fatal("label migration incorrectly treated as same-level repeat")
	}
	if result.Days[0].PreviousAvailable || result.Days[0].WeekDaysAvailable != 1 {
		t.Fatal("missing date presented as complete overlap")
	}
}

func TestQueryStationPeoplePreservesUnknownLevels(t *testing.T) {
	svc, _, connector := stationPeopleFixture()
	connector.result.Rows[0]["ps_level"] = "UNRECOGNIZED"
	result, err := svc.QueryStationPeople(context.Background(), "report", "user", "ALL", "2026-08-01", "2026-08-02", false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Levels["UNKNOWN"] == nil || result.Levels["UNKNOWN"].Users != 1 {
		t.Fatalf("unknown level lost: %+v", result)
	}
}

func TestQueryStationPeopleRejectsIncompletePagination(t *testing.T) {
	for _, scenario := range []string{"duplicate", "changed_total", "empty_page", "over_limit"} {
		t.Run(scenario, func(t *testing.T) {
			svc, store, connector := stationPeopleFixture()
			first := connector.result
			first.Pagination.Total = 2
			second := connector.result
			switch scenario {
			case "duplicate":
				second.Pagination.Total = 2
			case "changed_total":
				second.Pagination.Total = 3
			case "empty_page":
				second.Pagination.Total = 2
				second.Rows = nil
			case "over_limit":
				first.Pagination.Total = 500001
			}
			connector.results = []model.ReportQueryResult{first, second}
			_, err := svc.QueryStationPeople(context.Background(), "report", "user", "ALL", "2026-08-01", "2026-08-02", false)
			if !errors.Is(err, ErrReportInvalid) {
				t.Fatalf("expected complete pagination rejection, got %v", err)
			}
			if len(store.cache) != 0 {
				t.Fatal("partial statistics persisted")
			}
		})
	}
}

func TestBuildStationPeopleUsesExactSevenDaysAndStationScope(t *testing.T) {
	rows := []StationPersonObservation{
		{Date: "2026-08-01", Station: "A", DUID: "1", Level: "HIGH", Orders: 1},
		{Date: "2026-08-01", Station: "B", DUID: "2", Level: "HIGH", Orders: 1},
		{Date: "2026-08-08", Station: "A", DUID: "1", Level: "HIGH", Orders: 1},
		{Date: "2026-08-09", Station: "A", DUID: "2", Level: "HIGH", Orders: 1},
	}
	result, err := BuildStationPeople(rows, []string{"2026-08-01", "2026-08-08", "2026-08-09"}, "A", "2026-08-08", "2026-08-09")
	if err != nil {
		t.Fatal(err)
	}
	if result.Days[0].PreviousWeek != 1 || result.Days[1].PreviousWeek != 0 || result.Days[1].New != 1 {
		t.Fatalf("history crossed station/window: %+v", result.Days)
	}
}

func TestBuildStationPeopleRejectsConflictingDailyLabels(t *testing.T) {
	_, err := BuildStationPeople([]StationPersonObservation{
		{Date: "2026-08-01", Station: "A", DUID: "1", Level: "HIGH", Orders: 1},
		{Date: "2026-08-01", Station: "B", DUID: "1", Level: "LOW", Orders: 1},
	}, []string{"2026-08-01"}, "ALL", "2026-08-01", "2026-08-01")
	if !errors.Is(err, ErrReportInvalid) {
		t.Fatalf("expected conflict, got %v", err)
	}
}

type stationPeopleStoreFake struct {
	reportServiceStoreFake
	cache   map[string]*model.StationValidationResult
	expires map[string]time.Time
}

func (f *stationPeopleStoreFake) GetReportDefinition(context.Context, string) (*model.ReportDefinition, error) {
	return &model.ReportDefinition{ID: "report", DataSourceID: "parent", Enabled: true}, nil
}
func (f *stationPeopleStoreFake) GetReportDataSource(_ context.Context, id string) (*model.ReportDataSource, error) {
	api := "station_price_sensitive_test_detail"
	if id == "parent" {
		api = "price_sensitive_v1_2"
	}
	return &model.ReportDataSource{ID: id, APIName: api, Enabled: true}, nil
}
func (f *stationPeopleStoreFake) ListReportDataSources(context.Context) ([]model.ReportDataSource, error) {
	source, _ := f.GetReportDataSource(context.Background(), "station")
	return []model.ReportDataSource{*source}, nil
}
func (f *stationPeopleStoreFake) GetStationValidation(_ context.Context, key string, now time.Time) (*model.StationValidationResult, error) {
	if value := f.cache[key]; value != nil && f.expires[key].After(now) {
		return value, nil
	}
	if strings.HasPrefix(key, "station-validation:") {
		return &model.StationValidationResult{SourceID: "station", FetchedAt: "2026-08-02T00:00:00Z", AvailableDates: []string{"2026-08-01", "2026-08-02"}, Rows: []model.StationValidationDay{{StationID: "A"}}}, nil
	}
	return nil, nil
}
func (f *stationPeopleStoreFake) SaveStationValidation(_ context.Context, key, report string, result *model.StationValidationResult, expires time.Time) error {
	f.cache[key] = result
	f.expires[key] = expires
	return nil
}

func stationPeopleFixture() (*ReportService, *stationPeopleStoreFake, *reportConnectorFake) {
	store := &stationPeopleStoreFake{cache: map[string]*model.StationValidationResult{}, expires: map[string]time.Time{}}
	contract := &model.ReportDataSourceContract{Enabled: true}
	for _, name := range []string{"dt", "duid", "station_id", "station_name", "ps_level", "order_id", "label_match_status", "vehicle_type"} {
		contract.Fields = append(contract.Fields, model.ReportFieldContract{Name: name, Enabled: true, Selectable: true, Groupable: true, Sortable: true, Filterable: true, Aggregatable: true})
	}
	store.sourceContract = contract
	connector := &reportConnectorFake{}
	connector.result.Rows = []map[string]interface{}{{"dt": "2026-08-02", "station_id": "A", "duid": json.Number("9223372036854775806"), "ps_level": "HIGH", "users": json.Number("2")}}
	connector.result.Pagination.Total = 1
	runner := NewReportRunner(store, &reportRunnerStoreFake{}, connector)
	runner.now = func() time.Time { return time.Date(2026, 8, 2, 1, 0, 0, 0, time.UTC) }
	return NewReportService(store, &reportServiceUserStoreFake{admin: true}, runner), store, connector
}

func TestQueryStationPeopleCachesAggregatesWithoutUserIDs(t *testing.T) {
	svc, store, connector := stationPeopleFixture()
	result, err := svc.QueryStationPeople(context.Background(), "report", "user", "ALL", "2026-08-01", "2026-08-02", false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Users != 1 || result.RepeatUsers != 1 || result.MultiDayUsers != 0 {
		t.Fatalf("summary: %+v", result)
	}
	encoded, _ := json.Marshal(store.cache)
	if strings.Contains(string(encoded), "9223372036854775806") || strings.Contains(string(encoded), "duid") {
		t.Fatal("identity leaked to cache")
	}
	query := string(connector.query)
	if !strings.Contains(query, "COUNT_DISTINCT") || !strings.Contains(query, "order_id") || !strings.Contains(query, "MATCHED") {
		t.Fatalf("missing boundary contract: %s", query)
	}
	connector.err = errors.New("upstream offline")
	cached, err := svc.QueryStationPeople(context.Background(), "report", "user", "ALL", "2026-08-01", "2026-08-02", false)
	if err != nil || cached.Users != 1 {
		t.Fatalf("cache unavailable: %v", err)
	}
	_, err = svc.QueryStationPeople(context.Background(), "report", "user", "ALL", "2026-08-01", "2026-08-02", true)
	if err == nil {
		t.Fatal("forced refresh ignored upstream error")
	}
}

func TestQueryStationPeopleEnforcesPermissionsAndRevokedFields(t *testing.T) {
	svc, store, _ := stationPeopleFixture()
	normal := NewReportService(store, &reportServiceUserStoreFake{}, svc.runner)
	_, err := normal.QueryStationPeople(context.Background(), "report", "user", "ALL", "2026-08-01", "2026-08-02", true)
	if !errors.Is(err, ErrReportForbidden) {
		t.Fatalf("refresh permission: %v", err)
	}
	_, err = normal.QueryStationPeople(context.Background(), "report", "user", "ALL", "2026-08-01", "2026-08-02", false)
	if err != nil {
		t.Fatal(err)
	}
	for i := range store.sourceContract.Fields {
		if store.sourceContract.Fields[i].Name == "order_id" {
			store.sourceContract.Fields[i].Enabled = false
		}
	}
	_, err = normal.QueryStationPeople(context.Background(), "report", "user", "ALL", "2026-08-01", "2026-08-02", false)
	if !errors.Is(err, ErrReportInvalid) {
		t.Fatalf("cache bypassed revoked contract: %v", err)
	}
}
