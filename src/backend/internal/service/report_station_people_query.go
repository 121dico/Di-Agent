package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// QueryStationPeople 独立按需查询；普通浏览宏观报表不触发用户级扫描。
func (s *ReportService) QueryStationPeople(ctx context.Context, reportID, userID, station, start, end string, refresh bool) (*model.StationPeopleResult, error) {
	if refresh {
		if err := s.requireAdmin(ctx, userID); err != nil {
			return nil, err
		}
	}
	base, err := s.QueryStationValidation(ctx, reportID, userID, false)
	if err != nil {
		return nil, err
	}
	validDates := map[string]bool{}
	validStation := station == "ALL"
	for _, date := range base.AvailableDates {
		validDates[date] = true
	}
	for _, day := range base.Rows {
		if day.StationID == station {
			validStation = true
		}
	}
	if !validDates[start] || !validDates[end] || start > end || !validStation {
		return nil, fmt.Errorf("%w: 请选择有效场站和日期区间", ErrReportInvalid)
	}
	source, err := s.store.GetReportDataSource(ctx, base.SourceID)
	if err != nil {
		return nil, err
	}
	if source == nil || !source.Enabled {
		return nil, ErrReportSourceMissing
	}
	contract, err := s.store.GetReportDataSourceContract(ctx, source.ID)
	if err != nil {
		return nil, err
	}
	if err := validateStationPeopleContract(contract); err != nil {
		return nil, err
	}
	raw, err := json.Marshal([]interface{}{"station-people-v1", reportID, base.FetchedAt, source, contract.Fields, station, start, end})
	if err != nil {
		return nil, err
	}
	key := fmt.Sprintf("station-people:%x", sha256.Sum256(raw))
	cache, hasCache := s.store.(stationValidationStore)
	if hasCache && !refresh {
		cached, err := cache.GetStationValidation(ctx, key, s.runner.now())
		if err != nil {
			return nil, err
		}
		if cached != nil && cached.People != nil {
			return cached.People, nil
		}
	}
	value, err, _ := s.runner.templateQueries.Do(key, func() (interface{}, error) {
		conditions := []map[string]interface{}{
			{"name": "dt", "operatorEnum": "IN", "value": base.AvailableDates},
			{"name": "dt", "operatorEnum": "LEQ", "value": end},
			{"name": "duid", "operatorEnum": "GQ", "value": 0},
			{"name": "label_match_status", "operatorEnum": "EQ", "value": "MATCHED"},
			{"name": "vehicle_type", "operatorEnum": "EQ", "value": "private"},
		}
		if station != "ALL" {
			conditions = append(conditions, map[string]interface{}{"name": "station_id", "operatorEnum": "EQ", "value": station})
		}
		rows, err := s.runner.stationGroupRows(ctx, *source, []string{"dt", "station_id", "duid", "ps_level"}, conditions, "order_id", 500000, 5000)
		if err != nil {
			return nil, err
		}
		observations := make([]StationPersonObservation, 0, len(rows))
		for _, row := range rows {
			duid := fmt.Sprint(row["duid"])
			id, err := strconv.ParseInt(duid, 10, 64)
			if err != nil || id <= 0 {
				return nil, fmt.Errorf("%w: 无效用户标识", ErrReportInvalid)
			}
			orders, err := stationUserCount(row)
			if err != nil {
				return nil, err
			}
			date, _ := row["dt"].(string)
			sid, _ := row["station_id"].(string)
			level, _ := row["ps_level"].(string)
			level = stationLevel(level)
			observations = append(observations, StationPersonObservation{Date: date, Station: sid, DUID: duid, Level: level, Orders: orders})
		}
		result, err := BuildStationPeople(observations, base.AvailableDates, station, start, end)
		if err != nil {
			return nil, err
		}
		result.FetchedAt = s.runner.now().UTC().Format(time.RFC3339)
		if hasCache {
			now := s.runner.now().In(time.FixedZone("Asia/Shanghai", 8*60*60))
			expires := time.Date(now.Year(), now.Month(), now.Day(), 10, 0, 0, 0, now.Location())
			if !expires.After(now) {
				expires = expires.AddDate(0, 0, 1)
			}
			if err := cache.SaveStationValidation(ctx, key, reportID, &model.StationValidationResult{People: result}, expires); err != nil {
				return nil, err
			}
		}
		return result, nil
	})
	if err != nil {
		return nil, err
	}
	return value.(*model.StationPeopleResult), nil
}

func validateStationPeopleContract(contract *model.ReportDataSourceContract) error {
	if err := validateStationContract(contract); err != nil {
		return err
	}
	fields := map[string]model.ReportFieldContract{}
	for _, field := range contract.Fields {
		if field.Enabled && !field.Sensitive {
			fields[field.Name] = field
		}
	}
	if !fields["duid"].Groupable || !fields["duid"].Sortable || !fields["order_id"].Selectable || !fields["order_id"].Aggregatable || !fields["station_id"].Filterable {
		return fmt.Errorf("%w: 用户复购所需的 DUID 分组、订单去重或场站筛选未开放", ErrReportInvalid)
	}
	return nil
}
