package service

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// QueryStationScoreEvidence 有界匹配同日标签，拒绝用最新标签解释历史消费。
func (s *ReportService) QueryStationScoreEvidence(ctx context.Context, reportID, userID, station, start, end, level, minDays string) (*model.StationScoreEvidence, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	n, err := strconv.Atoi(minDays)
	a, aerr := time.Parse("2006-01-02", start)
	b, berr := time.Parse("2006-01-02", end)
	if err != nil || n < 1 || n > 365 || station == "" || station == "ALL" || (level != "HIGH" && level != "VERY_HIGH") || aerr != nil || berr != nil || a.After(b) || b.Sub(a) > 364*24*time.Hour {
		return nil, fmt.Errorf("%w: 请选择单个场站、有效日期、高或极高等级及1至365个消费日", ErrReportInvalid)
	}
	ctx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	base, err := s.QueryStationValidation(ctx, reportID, userID, false)
	if err != nil {
		return nil, err
	}
	known := map[string]bool{}
	for _, day := range base.AvailableDates {
		known[day] = true
	}
	validStation := false
	for _, row := range base.Rows {
		if row.StationID == station {
			validStation = true
		}
	}
	if !known[start] || !known[end] || !validStation {
		return nil, fmt.Errorf("%w: 场站或日期无可用数据", ErrReportInvalid)
	}
	stationSource, err := s.store.GetReportDataSource(ctx, base.SourceID)
	if err != nil {
		return nil, err
	}
	if stationSource == nil || !stationSource.Enabled {
		return nil, ErrReportSourceMissing
	}
	stationContract, err := s.store.GetReportDataSourceContract(ctx, stationSource.ID)
	if err != nil {
		return nil, err
	}
	if err := validateStationPeopleContract(stationContract); err != nil {
		return nil, err
	}
	if err := requireEvidenceFields(stationContract, []string{"label_dt"}, true); err != nil {
		return nil, err
	}
	report, source, err := s.runner.resolve(ctx, reportID)
	if err != nil {
		return nil, err
	}
	if !isV12Report(report) || source.APIName != "price_sensitive_v1_2" || !source.Enabled {
		return nil, ErrReportInvalid
	}
	contract, err := s.store.GetReportDataSourceContract(ctx, source.ID)
	if err != nil {
		return nil, err
	}
	if err := requireEvidenceFields(contract, []string{"duid", "dt", "ps_level"}, false); err != nil {
		return nil, err
	}
	available := map[string]model.ReportFieldContract{}
	for _, f := range contract.Fields {
		available[f.Name] = f
	}
	for _, name := range []string{"duid", "dt"} {
		if !available[name].Filterable {
			return nil, fmt.Errorf("%w: %s 未开放精确筛选", ErrReportInvalid, name)
		}
	}
	if !available["duid"].Sortable {
		return nil, fmt.Errorf("%w: duid 未开放排序", ErrReportInvalid)
	}
	conditions := []map[string]interface{}{
		{"name": "dt", "operatorEnum": "GEQ", "value": start}, {"name": "dt", "operatorEnum": "LEQ", "value": end},
		{"name": "station_id", "operatorEnum": "EQ", "value": station}, {"name": "duid", "operatorEnum": "GQ", "value": 0},
		{"name": "label_match_status", "operatorEnum": "EQ", "value": "MATCHED"}, {"name": "vehicle_type", "operatorEnum": "EQ", "value": "private"},
	}
	rows, err := s.runner.stationGroupRows(ctx, *stationSource, []string{"dt", "station_id", "duid", "ps_level", "label_dt"}, conditions, "order_id", 50000, 1000)
	if err != nil {
		return nil, err
	}
	cases, count, err := stationEvidenceCandidates(rows, known, station, start, end, level, n)
	if err != nil {
		return nil, err
	}
	for i := range cases {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if err := s.runner.loadStationScoreCase(ctx, *source, available, &cases[i]); err != nil {
			return nil, err
		}
	}
	return &model.StationScoreEvidence{StationID: station, Start: start, End: end, Level: level, MinDays: n, CandidateCount: count, Limit: 20, Cases: cases, FetchedAt: s.runner.now().UTC().Format(time.RFC3339)}, nil
}

func requireEvidenceFields(contract *model.ReportDataSourceContract, names []string, groups bool) error {
	if contract == nil || !contract.Enabled {
		return ErrReportSourceMissing
	}
	fields := map[string]model.ReportFieldContract{}
	for _, f := range contract.Fields {
		fields[f.Name] = f
	}
	for _, name := range names {
		f := fields[name]
		if !f.Enabled || f.Sensitive || !f.Selectable || (groups && (!f.Groupable || !f.Sortable)) {
			return fmt.Errorf("%w: 判分依据字段 %s 未开放所需查询能力", ErrReportInvalid, name)
		}
	}
	return nil
}

func stationEvidenceCandidates(rows []map[string]interface{}, known map[string]bool, station, start, end, level string, minDays int) ([]model.StationScoreCase, int, error) {
	people := map[string]*model.StationScoreCase{}
	seen := map[string]bool{}
	for _, row := range rows {
		date, _ := row["dt"].(string)
		id := fmt.Sprint(row["duid"])
		n, err := strconv.ParseInt(id, 10, 64)
		orders, oerr := stationUserCount(row)
		if err != nil || n <= 0 || oerr != nil || orders <= 0 || row["station_id"] != station || !known[date] || date < start || date > end || seen[id+"/"+date] {
			return nil, 0, fmt.Errorf("%w: 用户日分组无效、重复或标签冲突", ErrReportInvalid)
		}
		seen[id+"/"+date] = true
		p := people[id]
		if p == nil {
			p = &model.StationScoreCase{DUID: id, FirstDate: date}
			people[id] = p
		}
		p.ConsumptionDays++
		p.Orders += orders
		if date < p.FirstDate {
			p.FirstDate = date
		}
		if date > p.LastDate {
			p.LastDate = date
			p.LabelDate, _ = row["label_dt"].(string)
			l, _ := row["ps_level"].(string)
			p.Level = stationLevel(l)
		}
	}
	result := []model.StationScoreCase{}
	for _, p := range people {
		if p.ConsumptionDays >= minDays && p.Level == level {
			result = append(result, *p)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ConsumptionDays != result[j].ConsumptionDays {
			return result[i].ConsumptionDays > result[j].ConsumptionDays
		}
		if result[i].Orders != result[j].Orders {
			return result[i].Orders > result[j].Orders
		}
		return result[i].DUID < result[j].DUID
	})
	count := len(result)
	if len(result) > 20 {
		result = result[:20]
	}
	return result, count, nil
}
