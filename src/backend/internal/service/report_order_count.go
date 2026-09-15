package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func (s *ReportService) QueryOrderCohort(ctx context.Context, reportID, date, orders string, cities []string) (*model.ReportAnalyticsResult, error) {
	return s.runner.QueryOrderCohort(ctx, reportID, date, orders, cities)
}

// QueryOrderCohort 仅重算所选单日人群，不重扫整个历史区间。
func (r *ReportRunner) QueryOrderCohort(ctx context.Context, reportID, date, orders string, cities []string) (*model.ReportAnalyticsResult, error) {
	if _, err := time.Parse("2006-01-02", date); err != nil {
		return nil, fmt.Errorf("%w: 请选择有效快照日期", ErrReportInvalid)
	}
	if n, err := strconv.Atoi(orders); orders != "all" && orders != "gt10" && (err != nil || n < 1 || n > 10 || strconv.Itoa(n) != orders) {
		return nil, fmt.Errorf("%w: 订单笔数必须为1至10、gt10或all", ErrReportInvalid)
	}
	report, source, err := r.resolve(ctx, reportID)
	if err != nil {
		return nil, err
	}
	if !isV12Report(report) {
		return nil, fmt.Errorf("%w: 仅支持V1.2价敏报表", ErrReportInvalid)
	}
	reader, ok := r.catalog.(reportContractReader)
	if !ok {
		return nil, fmt.Errorf("%w: 缺少字段契约", ErrReportInvalid)
	}
	contract, err := reader.GetReportDataSourceContract(ctx, source.ID)
	if err != nil {
		return nil, err
	}
	if contract == nil || !contract.Enabled || !source.Enabled {
		return nil, ErrReportSourceMissing
	}
	cities = normalizeAnalyticsCities(cities)
	if len(cities) > 50 {
		return nil, fmt.Errorf("%w: 城市最多50项", ErrReportInvalid)
	}
	sort.Strings(cities)
	base := &model.ReportAnalyticsResult{Range: "1d", StartDate: date, EndDate: date}
	queries, err := buildOrderCountQueries(report, base, cities, orders)
	if err != nil {
		return nil, err
	}
	existence := queries[2]
	queries = queries[:2]
	available := map[string]model.ReportFieldContract{}
	for _, f := range contract.Fields {
		available[f.Name] = f
	}
	raws := make([]json.RawMessage, len(queries))
	for i, query := range queries {
		query["needPagination"], query["pageSize"], query["page"] = true, 1000, 1
		raws[i], err = json.Marshal(query)
		if err != nil {
			return nil, err
		}
		var decoded map[string]any
		if err := json.Unmarshal(raws[i], &decoded); err != nil {
			return nil, err
		}
		if err := validateQueryContractLevel(decoded, available); err != nil {
			return nil, err
		}
	}
	if _, ok := r.catalog.(reportPreparedStore); ok {
		result, err := r.readPreparedAnalytics(ctx, report, source, contract, base, cities)
		if err != nil {
			return nil, err
		}
		if result.DataDate != date || result.OrderGroups[orders] == nil {
			return nil, fmt.Errorf("%w: 该日期正在后台初始化", ErrReportInvalid)
		}
		result.OrderCohort = result.OrderGroups[orders]
		return result, nil
	}
	// 撤销字段权限先于缓存；配置变化自动隔离旧结果。
	keyJSON, err := json.Marshal([]any{"order-count-v1", report, source, contract.Fields, date, orders, cities})
	if err != nil {
		return nil, err
	}
	key := fmt.Sprintf("order-count:%x", sha256.Sum256(keyJSON))
	cache, hasCache := r.catalog.(reportTemplateAnalyticsStore)
	valueResult, err, _ := r.templateQueries.Do(key, func() (any, error) {
		if hasCache {
			cached, err := cache.GetTemplateAnalytics(ctx, key, r.now())
			if err != nil {
				return nil, err
			}
			if cached != nil {
				copy := *cached
				copy.Cached = true
				return &copy, nil
			}
		}
		result := *base
		result.DataDate, result.Profile, result.FetchedAt = date, "price_sensitive_v1_2", r.now().Format(time.RFC3339)
		result.CountingBasis = "ps_conf > 0、duid > 0；order_cnt_180d 为标签最近更新时的订单数；按所选单日 COUNT_DISTINCT(duid)，分级人数与独立总人数核对"
		result.OrderCohort = &model.ReportAnalyticsCohort{Distribution: []model.ReportAnalyticsDistribution{}}
		var sum int64
		seen := map[string]bool{}
		for i, raw := range raws {
			queryKey := "order_count_distribution"
			if i == 1 {
				queryKey = "order_count_total"
			}
			upstream, execution, err := r.executeV12Aggregate(ctx, report, source, queryKey, raw, date, date, cities, "")
			if err != nil {
				return nil, err
			}
			if execution != nil {
				result.ExecutionIDs = append(result.ExecutionIDs, execution.ID)
			}
			if i == 1 && len(upstream.Rows) > 1 {
				return nil, fmt.Errorf("%w: 总人数返回多行", ErrReportInvalid)
			}
			for _, row := range upstream.Rows {
				count, err := strconv.ParseInt(fmt.Sprint(row["user_count"]), 10, 64)
				if err != nil || count < 0 || count > 9007199254740991 || fmt.Sprint(row["dt"]) != date {
					return nil, fmt.Errorf("%w: 上游人数或日期无效", ErrReportInvalid)
				}
				if i == 1 {
					result.OrderCohort.UserCount = count
					continue
				}
				level, _ := row["level"].(string)
				level = stationLevel(level)
				if seen[level] {
					return nil, fmt.Errorf("%w: 价敏等级重复", ErrReportInvalid)
				}
				seen[level] = true
				sum += count
				result.OrderCohort.Distribution = append(result.OrderCohort.Distribution, model.ReportAnalyticsDistribution{Level: level, UserCount: count})
			}
		}
		if sum != result.OrderCohort.UserCount {
			return nil, fmt.Errorf("%w: 分级人数与去重总人数不一致", ErrReportInvalid)
		}
		if sum == 0 {
			// 零人群必须以真实存在的源分区为前提，缺失快照不能补零。
			existence["needPagination"], existence["pageSize"], existence["page"] = true, 1000, 1
			raw, err := json.Marshal(existence)
			if err != nil {
				return nil, err
			}
			upstream, _, err := r.executeV12Aggregate(ctx, report, source, "order_count_snapshot", raw, date, date, cities, "")
			if err != nil {
				return nil, err
			}
			if len(upstream.Rows) != 1 || fmt.Sprint(upstream.Rows[0]["dt"]) != date {
				return nil, fmt.Errorf("%w: 所选范围没有可用快照，不能作为零人群", ErrReportInvalid)
			}
		}
		if hasCache {
			if err := cache.SaveTemplateAnalytics(ctx, key, reportID, &result, r.now().Add(10*time.Minute)); err != nil {
				return nil, err
			}
		}
		return &result, nil
	})
	if err != nil {
		return nil, err
	}
	raw, err := json.Marshal(valueResult)
	if err != nil {
		return nil, err
	}
	var result model.ReportAnalyticsResult
	err = json.Unmarshal(raw, &result)
	return &result, err
}
