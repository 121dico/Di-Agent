package service

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"math"
	"strconv"
	"strings"
	"time"
)

func preparedCityQuery(query map[string]any) map[string]any {
	query["fieldList"] = append(query["fieldList"].([]map[string]any), analyticsField("city_name", "city", ""))
	groups := append(query["groupList"].([]string), "city_name")
	query["groupList"], query["orderBy"] = groups, strings.Join(groups, ",")
	return query
}

// 仅允许固定聚合字段，分页完整性检查通过后才能发布日期快照。
func (r *ReportRunner) preparedRows(ctx context.Context, report *model.ReportDefinition, source *model.ReportDataSource, contract *model.ReportDataSourceContract, date, key string, query map[string]any) ([]map[string]any, []string, error) {
	fields := map[string]model.ReportFieldContract{}
	for _, f := range contract.Fields {
		fields[f.Name] = f
	}
	rows := []map[string]any{}
	ids := []string{}
	seen := map[string]bool{}
	expected := int64(-1)
	for page := 1; page <= 100; page++ {
		query["needPagination"], query["pageSize"], query["page"] = true, 10000, page
		raw, err := json.Marshal(query)
		if err != nil {
			return nil, nil, err
		}
		var decoded map[string]any
		if err = json.Unmarshal(raw, &decoded); err != nil {
			return nil, nil, err
		}
		if err = validateQueryContractLevel(decoded, fields); err != nil {
			return nil, nil, err
		}
		result, execution, err := r.executeV12Aggregate(ctx, report, source, "prepared_"+key, raw, date, date, nil, "")
		if err != nil {
			return nil, nil, err
		}
		if execution != nil {
			ids = append(ids, execution.ID)
		}
		if result.Pagination.Total > 100000 {
			return nil, nil, fmt.Errorf("%w: 聚合组超过100000", ErrReportInvalid)
		}
		// 大页必须有可核对的总量；不能把网关静默截断的一页当作完整结果。
		if len(result.Rows) > 0 && result.Pagination.Total <= 0 {
			return nil, nil, fmt.Errorf("%w: 非空聚合缺少分页总量", ErrReportInvalid)
		}
		if result.Pagination.PageSize > 0 && result.Pagination.PageSize != 10000 {
			return nil, nil, fmt.Errorf("%w: 上游聚合分页大小与请求不一致", ErrReportInvalid)
		}
		if page == 1 {
			expected = result.Pagination.Total
		} else if expected != result.Pagination.Total {
			return nil, nil, fmt.Errorf("%w: 聚合分页总量变化", ErrReportInvalid)
		}
		for _, row := range result.Rows {
			for _, field := range query["fieldList"].([]map[string]any) {
				alias, _ := field["alias"].(string)
				if alias == "" {
					alias, _ = field["name"].(string)
				}
				if _, ok := row[alias]; !ok {
					return nil, nil, fmt.Errorf("%w: 聚合缺少字段 %s", ErrReportInvalid, alias)
				}
			}
			if fmt.Sprint(row["dt"]) != date {
				return nil, nil, fmt.Errorf("%w: 聚合日期不一致", ErrReportInvalid)
			}
			signature, _ := json.Marshal([]any{row["dt"], row["city"], row["level"], row["score_type"]})
			if seen[string(signature)] {
				return nil, nil, fmt.Errorf("%w: 聚合分页重复", ErrReportInvalid)
			}
			seen[string(signature)] = true
			for k, v := range row {
				if k == "dt" || k == "city" || k == "level" || k == "score_type" {
					continue
				}
				if v == nil {
					if strings.HasSuffix(k, "_avg") || k == "total_order_count" {
						continue
					}
					return nil, nil, fmt.Errorf("%w: 聚合计数为空", ErrReportInvalid)
				}
				n, parseErr := strconv.ParseFloat(fmt.Sprint(v), 64)
				if parseErr != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 9007199254740991 || (!strings.HasSuffix(k, "_avg") && n != math.Trunc(n)) {
					return nil, nil, fmt.Errorf("%w: 聚合数值无效", ErrReportInvalid)
				}
			}
			rows = append(rows, row)
		}
		if expected > 0 && int64(len(rows)) == expected {
			return rows, ids, nil
		}
		if expected > 0 && (len(result.Rows) == 0 || int64(len(rows)) > expected) {
			return nil, nil, fmt.Errorf("%w: 聚合分页缺失", ErrReportInvalid)
		}
		if expected <= 0 && len(result.Rows) < 10000 && result.Pagination.PageCount <= 1 {
			return rows, ids, nil
		}
	}
	return nil, nil, fmt.Errorf("%w: 聚合分页超过上限", ErrReportInvalid)
}

func (r *ReportRunner) buildPreparedDay(ctx context.Context, report *model.ReportDefinition, source *model.ReportDataSource, contract *model.ReportDataSourceContract, date string) (*model.ReportPreparedDay, error) {
	base := &model.ReportAnalyticsResult{Range: "1d", StartDate: date, EndDate: date}
	queries, keys, err := buildV12AggregateQueries(report, base, nil)
	if err != nil {
		return nil, err
	}
	day := &model.ReportPreparedDay{Date: date, Groups: map[string][]map[string]any{}}
	for i := 0; i < 3; i++ {
		rows, ids, err := r.preparedRows(ctx, report, source, contract, date, keys[i], preparedCityQuery(queries[i]))
		if err != nil {
			return nil, err
		}
		day.ExecutionIDs = append(day.ExecutionIDs, ids...)
		switch i {
		case 0:
			day.Totals = rows
		case 1:
			day.Assigned = rows
		case 2:
			day.Orders = rows
		}
	}
	if len(day.Totals) == 0 {
		return nil, fmt.Errorf("%w: 快照没有全量统计", ErrReportInvalid)
	}
	for _, group := range []string{"all", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "gt10"} {
		queries, err := buildOrderCountQueries(report, base, nil, group)
		if err != nil {
			return nil, err
		}
		rows, ids, err := r.preparedRows(ctx, report, source, contract, date, "order_count_"+group, preparedCityQuery(queries[0]))
		if err != nil {
			return nil, err
		}
		day.ExecutionIDs = append(day.ExecutionIDs, ids...)
		totals, ids, err := r.preparedRows(ctx, report, source, contract, date, "order_total_"+group, queries[1])
		if err != nil {
			return nil, err
		}
		day.ExecutionIDs = append(day.ExecutionIDs, ids...)
		var total int64
		if len(totals) > 1 {
			return nil, fmt.Errorf("%w: 去重总量多行", ErrReportInvalid)
		}
		if len(totals) == 1 {
			total = int64(analyticsNumber(totals[0], "user_count"))
		}
		if preparedCohort(rows, nil).UserCount != total {
			return nil, fmt.Errorf("%w: 城市等级合计与独立去重总量不一致，不能合并", ErrReportInvalid)
		}
		day.Groups[group] = rows
	}
	day.FetchedAt = r.now().UTC().Format(time.RFC3339)
	return day, nil
}
