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

type stationMacroStore struct{ *stationPeopleStoreFake }

func (f *stationMacroStore) GetStationValidation(_ context.Context, key string, now time.Time) (*model.StationValidationResult, error) {
	if f.expires[key].After(now) {
		return f.cache[key], nil
	}
	return nil, nil
}

type stationMacroConnector struct {
	t        *testing.T
	calls    int
	conflict bool
}

func (f *stationMacroConnector) Query(_ context.Context, _ model.ReportDataSource, body []byte) (model.ReportQueryResult, error) {
	f.calls++
	var query struct {
		Groups []string                 `json:"groupList"`
		Fields []map[string]interface{} `json:"fieldList"`
	}
	if err := json.Unmarshal(body, &query); err != nil {
		f.t.Fatal(err)
	}
	group := strings.Join(query.Groups, ",")
	rows := []map[string]interface{}{}
	if group == "dt" && len(query.Fields) == 1 {
		rows = []map[string]interface{}{{"dt": "2026-08-01"}, {"dt": "2026-08-03"}}
	} else if group == "station_id,station_name" {
		rows = []map[string]interface{}{{"station_id": "A", "station_name": "甲"}, {"station_id": "B", "station_name": "乙"}}
	} else {
		if !strings.Contains(string(body), "COUNT_DISTINCT") || !strings.Contains(string(body), "MATCHED") || !strings.Contains(string(body), "private") {
			f.t.Fatal("缺少去重或固定筛选")
		}
		ids := []string{"ALL"}
		if strings.Contains(group, "station_id") {
			ids = []string{"A", "B"}
		}
		for _, id := range ids {
			row := map[string]interface{}{"dt": "2026-08-01", "users": 1}
			if id != "ALL" {
				row["station_id"] = id
				row["station_name"] = id
			}
			if strings.Contains(group, "ps_level") {
				row["ps_level"] = "HIGH"
				if f.conflict {
					row["users"] = 2
				}
			}
			rows = append(rows, row)
		}
	}
	result := model.ReportQueryResult{Rows: rows}
	result.Pagination.Total = int64(len(rows))
	return result, nil
}

func TestQueryStationValidationDistinctAcrossStationsAndCache(t *testing.T) {
	_, base, _ := stationPeopleFixture()
	store := &stationMacroStore{base}
	connector := &stationMacroConnector{t: t}
	runner := NewReportRunner(store, &reportRunnerStoreFake{}, connector)
	svc := NewReportService(store, &reportServiceUserStoreFake{}, runner)
	result, err := svc.QueryStationValidation(context.Background(), "report", "user", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.AvailableDates) != 2 || len(result.Rows) != 6 {
		t.Fatalf("日期缺失被补造: %+v", result)
	}
	for _, row := range result.Rows {
		if row.Date == "2026-08-01" && row.Users != 1 {
			t.Fatalf("跨站去重错误: %+v", row)
		}
		if row.Date == "2026-08-03" && row.Users != 0 {
			t.Fatal("已知无消费日应为0")
		}
	}
	calls := connector.calls
	if _, err = svc.QueryStationValidation(context.Background(), "report", "user", false); err != nil || connector.calls != calls {
		t.Fatal("未复用缓存")
	}
	if _, err = svc.QueryStationValidation(context.Background(), "report", "user", true); !errors.Is(err, ErrReportForbidden) {
		t.Fatal("普通用户可以强刷")
	}
	base.sourceContract.Fields[0].Enabled = false
	if _, err = svc.QueryStationValidation(context.Background(), "report", "user", false); !errors.Is(err, ErrReportInvalid) {
		t.Fatal("缓存绕过字段撤销")
	}
}

func TestQueryStationValidationRejectsInconsistentBands(t *testing.T) {
	_, base, _ := stationPeopleFixture()
	store := &stationMacroStore{base}
	connector := &stationMacroConnector{t: t, conflict: true}
	svc := NewReportService(store, &reportServiceUserStoreFake{}, NewReportRunner(store, &reportRunnerStoreFake{}, connector))
	_, err := svc.QueryStationValidation(context.Background(), "report", "user", false)
	if !errors.Is(err, ErrReportInvalid) || len(base.cache) != 0 {
		t.Fatalf("错误分布被缓存: %v", err)
	}
}
