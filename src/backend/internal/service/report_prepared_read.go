package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"sort"
	"strings"
	"time"
)

type reportPreparedStore interface {
	ListPreparedReportDays(context.Context, string) ([]model.ReportPreparedDay, error)
	SavePreparedReportDay(context.Context, string, string, *model.ReportPreparedDay) error
}

func preparedPrefix(report *model.ReportDefinition, source *model.ReportDataSource, contract *model.ReportDataSourceContract) string {
	raw, _ := json.Marshal([]any{"prepared-v1", report, source, contract.Fields})
	return fmt.Sprintf("prepared:%x:", sha256.Sum256(raw))
}

func preparedCity(city string) string { return strings.TrimSuffix(strings.TrimSpace(city), "市") }

func preparedCityMatch(row map[string]any, cities map[string]bool) bool {
	if len(cities) == 0 {
		return true
	}
	city, _ := row["city"].(string)
	return cities[preparedCity(city)]
}

func preparedCohort(rows []map[string]any, cities map[string]bool) *model.ReportAnalyticsCohort {
	cohort := &model.ReportAnalyticsCohort{Distribution: []model.ReportAnalyticsDistribution{}}
	levels := map[string]int64{}
	for _, row := range rows {
		if preparedCityMatch(row, cities) {
			count := int64(analyticsNumber(row, "user_count"))
			levels[stationLevel(fmt.Sprint(row["level"]))] += count
			cohort.UserCount += count
		}
	}
	for level, count := range levels {
		cohort.Distribution = append(cohort.Distribution, model.ReportAnalyticsDistribution{Level: level, UserCount: count})
	}
	sort.Slice(cohort.Distribution, func(i, j int) bool { return cohort.Distribution[i].Level < cohort.Distribution[j].Level })
	return cohort
}

func assemblePreparedHistory(base *model.ReportAnalyticsResult, days []model.ReportPreparedDay, cities []string) *model.ReportAnalyticsResult {
	selected := map[string]bool{}
	for _, city := range cities {
		selected[preparedCity(city)] = true
	}
	responses := make([]model.ReportQueryResult, 3)
	var latest *model.ReportPreparedDay
	var dates []string
	for i := range days {
		day := &days[i]
		if day.Date < base.StartDate || day.Date > base.EndDate {
			continue
		}
		matched := false
		for _, row := range day.Totals {
			if preparedCityMatch(row, selected) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		dates = append(dates, day.Date)
		if latest == nil || day.Date > latest.Date {
			latest = day
		}
		total := map[string]any{"dt": day.Date, "total_user_count": int64(0), "total_order_count": int64(0)}
		for _, row := range day.Totals {
			if preparedCityMatch(row, selected) {
				for _, key := range []string{"total_user_count", "total_order_count"} {
					total[key] = int64(analyticsNumber(total, key)) + int64(analyticsNumber(row, key))
				}
			}
		}
		responses[0].Rows = append(responses[0].Rows, total)
		for _, row := range day.Assigned {
			if preparedCityMatch(row, selected) {
				responses[1].Rows = append(responses[1].Rows, row)
			}
		}
		for _, row := range day.Orders {
			if preparedCityMatch(row, selected) {
				responses[2].Rows = append(responses[2].Rows, row)
			}
		}
	}
	result := assembleV12Analytics(base, responses, time.Now())
	result.Prepared, result.Cached = true, true
	result.CountingBasis = "按源表每个 dt + duid 一行的契约计数；不跨日期累加用户"
	sort.Strings(dates)
	result.AvailableDates = dates
	if latest == nil {
		return result
	}
	result.FetchedAt = latest.FetchedAt
	for _, day := range days {
		if day.Date >= base.StartDate && day.Date <= base.EndDate {
			result.ExecutionIDs = append(result.ExecutionIDs, day.ExecutionIDs...)
		}
	}
	result.OrderGroups = map[string]*model.ReportAnalyticsCohort{}
	for group, rows := range latest.Groups {
		result.OrderGroups[group] = preparedCohort(rows, selected)
	}
	result.OrderCohort = result.OrderGroups["all"]
	for i := range result.Trend {
		point := &result.Trend[i]
		for _, day := range days {
			if day.Date == point.Date {
				cohort := preparedCohort(day.Orders, selected)
				point.OrderUserCount = cohort.UserCount
				point.OrderDistribution = cohort.Distribution
				break
			}
		}
	}
	if result.OrderCohort != nil && result.Summary.TotalUserCount > 0 {
		result.OrderCohort.Share = float64(result.OrderCohort.UserCount) / float64(result.Summary.TotalUserCount) * 100
	}
	return result
}

func (r *ReportRunner) readPreparedAnalytics(ctx context.Context, report *model.ReportDefinition, source *model.ReportDataSource, contract *model.ReportDataSourceContract, base *model.ReportAnalyticsResult, cities []string) (*model.ReportAnalyticsResult, error) {
	store := r.catalog.(reportPreparedStore)
	prefix := preparedPrefix(report, source, contract)
	// 首次从数据库装载；后台发布新日期时失效，浏览查询不重复解析全历史 JSON。
	r.preparedMu.Lock()
	if r.preparedCache == nil {
		r.preparedCache = map[string][]model.ReportPreparedDay{}
	}
	days, known := r.preparedCache[prefix]
	var err error
	if !known {
		days, err = store.ListPreparedReportDays(ctx, prefix)
		if err == nil && len(days) > 0 {
			if len(r.preparedCache) >= 8 {
				r.preparedCache = map[string][]model.ReportPreparedDay{}
			}
			r.preparedCache[prefix] = days
		}
	}
	r.preparedMu.Unlock()
	if err != nil {
		return nil, err
	}
	if len(days) > 1000 {
		return nil, fmt.Errorf("%w: 快照历史超过1000天", ErrReportInvalid)
	}
	if len(days) == 0 {
		previous, oldErr := r.savedV12History(ctx, report, source, base, cities)
		if oldErr == nil && previous.DataDate != "" {
			previous.Prepared = true
			return previous, nil
		}
		return nil, fmt.Errorf("%w: 报表正在后台初始化，请稍后查看", ErrReportInvalid)
	}
	result := assemblePreparedHistory(base, days, cities)
	if len(result.AvailableDates) == 0 {
		return nil, fmt.Errorf("%w: 所选日期或城市暂无已生成快照", ErrReportInvalid)
	}
	return result, nil
}
