package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

var ErrReportAggregateCapacity = errors.New("上游全量去重统计超出资源限制，请缩小城市或日期范围；全量报表需要上游预聚合支持")

type reportTemplateAnalyticsStore interface {
	GetTemplateAnalytics(context.Context, string, time.Time) (*model.ReportAnalyticsResult, error)
	SaveTemplateAnalytics(context.Context, string, string, *model.ReportAnalyticsResult, time.Time) error
	InvalidateTemplateAnalytics(context.Context, string) error
}

type reportContractReader interface {
	GetReportDataSourceContract(context.Context, string) (*model.ReportDataSourceContract, error)
}

// queryV12Analytics 从真实标签快照聚合，不下载用户明细，不把 dt 当作订单日期。
func (r *ReportRunner) queryV12Analytics(ctx context.Context, report *model.ReportDefinition, source *model.ReportDataSource, base *model.ReportAnalyticsResult, option ReportAnalyticsOptions) (*model.ReportAnalyticsResult, error) {
	reader, ok := r.catalog.(reportContractReader)
	if !ok {
		return nil, fmt.Errorf("%w: 缺少数据源字段契约", ErrReportInvalid)
	}
	contract, err := reader.GetReportDataSourceContract(ctx, source.ID)
	if err != nil {
		return nil, err
	}
	if contract == nil || !contract.Enabled || !source.Enabled {
		return nil, ErrReportSourceMissing
	}
	var template ReportTemplate
	if err := json.Unmarshal(reportTemplateOne, &template); err != nil {
		return nil, err
	}
	p := template.Profiles["price_sensitive_v1_2"]
	if err := validateTemplateProfile(contract, p); err != nil {
		return nil, err
	}
	confidenceAllowed := false
	for _, field := range contract.Fields {
		if field.Name == "ps_conf" && field.Enabled && field.Filterable {
			confidenceAllowed = true
		}
	}
	if !confidenceAllowed {
		return nil, fmt.Errorf("%w: ps_conf 未开放筛选，无法统计有订单人群", ErrReportInvalid)
	}
	cities := normalizeAnalyticsCities(option.Cities)
	if len(cities) > 50 {
		return nil, fmt.Errorf("%w: 城市筛选最多支持50项", ErrReportInvalid)
	}
	sort.Strings(cities)
	if base.Range == "saved" {
		return r.savedV12History(ctx, report, source, base, cities)
	}
	key := v12SnapshotKey(report, source, base, cities)
	cache, hasCache := r.catalog.(reportTemplateAnalyticsStore)
	if hasCache && !option.ForceRefresh {
		cached, err := cache.GetTemplateAnalytics(ctx, key, r.now())
		if err != nil {
			return nil, err
		}
		if cached != nil {
			cached.Cached = true
			return cached, nil
		}
	}
	// 合并同筛选并发读取，避免多个页面同时扫描相同的亿级源表。
	value, err, _ := r.templateQueries.Do(key, func() (any, error) {
		queries, keys, err := buildV12AggregateQueries(report, base, cities)
		if err != nil {
			return nil, err
		}
		results := make([]model.ReportQueryResult, 0, len(queries))
		executionIDs := []string{}
		for index, query := range queries {
			query["needPagination"], query["pageSize"], query["page"] = true, 1000, 1
			raw, err := json.Marshal(query)
			if err != nil {
				return nil, err
			}
			available := make(map[string]model.ReportFieldContract)
			for _, field := range contract.Fields {
				available[field.Name] = field
			}
			var decoded map[string]any
			if err := json.Unmarshal(raw, &decoded); err != nil {
				return nil, err
			}
			if err := validateQueryContractLevel(decoded, available); err != nil {
				return nil, err
			}
			result, execution, err := r.executeV12Aggregate(ctx, report, source, keys[index], raw, base.StartDate, base.EndDate, cities, "")
			if err != nil {
				if strings.Contains(err.Error(), "MEMORY_LIMIT_EXCEEDED") || strings.Contains(err.Error(), "Memory limit") || strings.Contains(err.Error(), "TOO_SLOW") {
					return nil, ErrReportAggregateCapacity
				}
				return nil, err
			}
			if result.Pagination.Total > int64(len(result.Rows)) || result.Pagination.PageCount > 1 || len(result.Rows) >= 1000 {
				return nil, fmt.Errorf("%w: 聚合结果超过单次返回上限，请缩短日期范围，当前未展示不完整统计", ErrReportInvalid)
			}
			results = append(results, result)
			if _, persisted := r.catalog.(reportProvenanceStore); persisted && execution != nil {
				executionIDs = append(executionIDs, execution.ID)
			}
		}
		if base.Range == "dates" {
			result := *base
			result.ExecutionIDs = executionIDs
			result.AvailableDates = []string{}
			for _, row := range results[0].Rows {
				date := fmt.Sprint(row["dt"])
				if _, err := time.Parse("2006-01-02", date); err == nil && date >= base.StartDate && date <= base.EndDate {
					result.AvailableDates = append(result.AvailableDates, date)
				}
			}
			sort.Strings(result.AvailableDates)
			return &result, nil
		}
		result := assembleV12Analytics(base, results, r.now())
		result.ExecutionIDs = executionIDs
		result.CountingBasis = "按源表每个 dt + duid 一行的契约计数；未执行全量去重校验，不跨日期累加用户"
		result.OrderCohort = &model.ReportAnalyticsCohort{Distribution: []model.ReportAnalyticsDistribution{}}
		for _, row := range results[2].Rows {
			for i := range result.Trend {
				if result.Trend[i].Date == fmt.Sprint(row["dt"]) {
					level, _ := row["level"].(string)
					if level == "" {
						level = "UNKNOWN"
					}
					count := int64(analyticsNumber(row, "user_count"))
					result.Trend[i].OrderUserCount += count
					result.Trend[i].OrderDistribution = append(result.Trend[i].OrderDistribution, model.ReportAnalyticsDistribution{Level: level, UserCount: count})
				}
			}
			if fmt.Sprint(row["dt"]) != result.DataDate {
				continue
			}
			level, _ := row["level"].(string)
			if level == "" {
				level = "UNKNOWN"
			}
			count := int64(analyticsNumber(row, "user_count"))
			result.OrderCohort.UserCount += count
			result.OrderCohort.Distribution = append(result.OrderCohort.Distribution, model.ReportAnalyticsDistribution{Level: level, UserCount: count})
		}
		if result.Summary.TotalUserCount > 0 {
			result.OrderCohort.Share = float64(result.OrderCohort.UserCount) / float64(result.Summary.TotalUserCount) * 100
		}
		if hasCache {
			if err := cache.SaveTemplateAnalytics(ctx, key, report.ID, result, r.now().Add(10*time.Minute)); err != nil {
				return nil, err
			}
		}
		return result, nil
	})
	if err != nil {
		return nil, err
	}
	// 避免并发调用者共享可变切片/指针。
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var result model.ReportAnalyticsResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
