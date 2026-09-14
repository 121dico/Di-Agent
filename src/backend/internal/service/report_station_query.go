package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func (r *ReportRunner) loadStationValidation(ctx context.Context, source model.ReportDataSource) (*model.StationValidationResult, error) {
	directory, err := r.stationGroups(ctx, source, []string{"dt"}, nil, false)
	if err != nil {
		return nil, err
	}
	result := &model.StationValidationResult{SourceID: source.ID, SourceName: "epower_platform.station_price_sensitive_test_detail", AvailableDates: []string{}, Rows: []model.StationValidationDay{}}
	for _, row := range directory {
		day, _ := row["dt"].(string)
		if _, err := time.Parse("2006-01-02", day); err != nil {
			return nil, fmt.Errorf("%w: 上游返回非法订单日期", ErrReportInvalid)
		}
		result.AvailableDates = append(result.AvailableDates, day)
	}
	sort.Strings(result.AvailableDates)
	if len(result.AvailableDates) > 365 {
		return nil, fmt.Errorf("%w: 验证区最多读取365天，请管理员限定数据源范围", ErrReportInvalid)
	}
	if len(result.AvailableDates) == 0 {
		result.FetchedAt = r.now().UTC().Format(time.RFC3339)
		return result, nil
	}
	firstDate, _ := time.Parse("2006-01-02", result.AvailableDates[0])
	lastDate, _ := time.Parse("2006-01-02", result.AvailableDates[len(result.AvailableDates)-1])
	if lastDate.Sub(firstDate) > 364*24*time.Hour {
		return nil, fmt.Errorf("%w: 数据验证日期跨度超过365天", ErrReportInvalid)
	}
	conditions := []map[string]interface{}{
		{"name": "dt", "operatorEnum": "IN", "value": result.AvailableDates},
		{"name": "duid", "operatorEnum": "GQ", "value": 0},
		{"name": "label_match_status", "operatorEnum": "EQ", "value": "MATCHED"},
		{"name": "vehicle_type", "operatorEnum": "EQ", "value": "private"},
	}
	stations, err := r.stationGroups(ctx, source, []string{"station_id", "station_name"}, []map[string]interface{}{{"name": "dt", "operatorEnum": "IN", "value": result.AvailableDates}}, false)
	if err != nil {
		return nil, err
	}
	days := map[string]*model.StationValidationDay{}
	// ALL 独立查询去重人数，不能将各站消费人数相加。
	for _, station := range []bool{false, true} {
		groups := []string{"dt"}
		if station {
			groups = append(groups, "station_id", "station_name")
		}
		totals, err := r.stationGroups(ctx, source, groups, conditions, true)
		if err != nil {
			return nil, err
		}
		for _, row := range totals {
			date, id, name, err := stationRowKey(row, station)
			if err != nil {
				return nil, err
			}
			key := date + "/" + id
			if days[key] != nil {
				return nil, fmt.Errorf("%w: 场站日期存在重复聚合，请核查场站名称", ErrReportInvalid)
			}
			count, err := stationUserCount(row)
			if err != nil {
				return nil, err
			}
			days[key] = &model.StationValidationDay{Date: date, StationID: id, StationName: name, Users: count, Levels: map[string]int64{}}
		}
		bands, err := r.stationGroups(ctx, source, append(groups, "ps_level"), conditions, true)
		if err != nil {
			return nil, err
		}
		for _, row := range bands {
			date, id, _, err := stationRowKey(row, station)
			if err != nil {
				return nil, err
			}
			day := days[date+"/"+id]
			if day == nil {
				return nil, fmt.Errorf("%w: 分布与人数查询不一致，请刷新重试", ErrReportInvalid)
			}
			level, _ := row["ps_level"].(string)
			level = stationLevel(level)
			count, err := stationUserCount(row)
			if err != nil {
				return nil, err
			}
			day.Levels[level] += count
		}
	}
	for _, date := range result.AvailableDates {
		if days[date+"/ALL"] == nil {
			days[date+"/ALL"] = &model.StationValidationDay{Date: date, StationID: "ALL", StationName: "全部场站（当天跨站去重）", Levels: map[string]int64{}}
		}
		for _, station := range stations {
			id, _ := station["station_id"].(string)
			name, _ := station["station_name"].(string)
			if id == "" || id == "ALL" {
				return nil, fmt.Errorf("%w: 场站目录ID无效", ErrReportInvalid)
			}
			if name == "" {
				name = id
			}
			if days[date+"/"+id] == nil {
				days[date+"/"+id] = &model.StationValidationDay{Date: date, StationID: id, StationName: name, Levels: map[string]int64{}}
			}
		}
	}
	for _, day := range days {
		var total int64
		for _, count := range day.Levels {
			total += count
		}
		if total != day.Users {
			return nil, fmt.Errorf("%w: %s 七档分布与去重人数不一致，可能存在同日多标签或数据更新，请核查", ErrReportInvalid, day.Date)
		}
		result.Rows = append(result.Rows, *day)
	}
	sort.Slice(result.Rows, func(i, j int) bool {
		if result.Rows[i].Date != result.Rows[j].Date {
			return result.Rows[i].Date < result.Rows[j].Date
		}
		return result.Rows[i].StationID < result.Rows[j].StationID
	})
	result.FetchedAt = r.now().UTC().Format(time.RFC3339)
	return result, nil
}

func stationRowKey(row map[string]interface{}, station bool) (string, string, string, error) {
	date, _ := row["dt"].(string)
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return "", "", "", fmt.Errorf("%w: 日期无效", ErrReportInvalid)
	}
	if !station {
		return date, "ALL", "全部场站（当天跨站去重）", nil
	}
	id, _ := row["station_id"].(string)
	name, _ := row["station_name"].(string)
	if id == "" || id == "ALL" {
		return "", "", "", fmt.Errorf("%w: 场站ID无效", ErrReportInvalid)
	}
	if name == "" {
		name = id
	}
	return date, id, name, nil
}

func stationUserCount(row map[string]interface{}) (int64, error) {
	n, err := strconv.ParseFloat(fmt.Sprint(row["users"]), 64)
	if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n != math.Trunc(n) || n > 9007199254740991 {
		return 0, fmt.Errorf("%w: 上游人数统计无效", ErrReportInvalid)
	}
	return int64(n), nil
}

func stationLevel(level string) string {
	switch level {
	case "VERY_LOW", "LOW", "MEDIUM_LOW", "MEDIUM", "MEDIUM_HIGH", "HIGH", "VERY_HIGH":
		return level
	default:
		return "UNKNOWN"
	}
}

// stationGroups 只分页获取聚合行。总量变化、空页或截断均失败，避免缓存半份报表。
func (r *ReportRunner) stationGroups(ctx context.Context, source model.ReportDataSource, groups []string, conditions []map[string]interface{}, count bool) ([]map[string]interface{}, error) {
	field := ""
	if count {
		field = "duid"
	}
	return r.stationGroupRows(ctx, source, groups, conditions, field, 50000, 1000)
}

func (r *ReportRunner) stationGroupRows(ctx context.Context, source model.ReportDataSource, groups []string, conditions []map[string]interface{}, countField string, limit, pageSize int) ([]map[string]interface{}, error) {
	fields := make([]map[string]interface{}, 0, len(groups)+1)
	for _, field := range groups {
		fields = append(fields, analyticsField(field, "", ""))
	}
	if countField != "" {
		fields = append(fields, analyticsField(countField, "users", "COUNT_DISTINCT"))
	}
	rows := []map[string]interface{}{}
	var expected int64 = -1
	seen := map[string]bool{}
	for page := 1; page <= limit/pageSize; page++ {
		query := map[string]interface{}{"fieldList": fields, "groupList": groups, "conditionList": conditions, "orderBy": strings.Join(groups, ","), "needPagination": true, "pageSize": pageSize, "page": page, "disableCache": true, "useMockData": false, "queryTypeEnum": "SYNC"}
		body, err := json.Marshal(query)
		if err != nil {
			return nil, fmt.Errorf("encode station query: %w", err)
		}
		result, err := r.connector.Query(ctx, source, body)
		if err != nil {
			return nil, fmt.Errorf("query station validation: %w", err)
		}
		if expected < 0 {
			expected = result.Pagination.Total
		}
		if result.Pagination.Total != expected || expected > int64(limit) {
			return nil, fmt.Errorf("%w: 聚合总数改变或超过%d行，请重试或缩小范围", ErrReportInvalid, limit)
		}
		for _, row := range result.Rows {
			parts := make([]interface{}, 0, len(groups))
			for _, group := range groups {
				parts = append(parts, row[group])
			}
			key, err := json.Marshal(parts)
			if err != nil {
				return nil, fmt.Errorf("encode station group: %w", err)
			}
			if seen[string(key)] {
				return nil, fmt.Errorf("%w: 聚合分页存在重复行", ErrReportInvalid)
			}
			seen[string(key)] = true
		}
		rows = append(rows, result.Rows...)
		if int64(len(rows)) == expected {
			return rows, nil
		}
		if len(result.Rows) == 0 || int64(len(rows)) > expected {
			return nil, fmt.Errorf("%w: 聚合分页不完整", ErrReportInvalid)
		}
	}
	return nil, fmt.Errorf("%w: 聚合分页超过限制", ErrReportInvalid)
}
