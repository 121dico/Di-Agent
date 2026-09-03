package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/google/uuid"
)

var (
	ErrReportNotFound      = errors.New("报表不存在")
	ErrReportSourceMissing = errors.New("报表数据源不存在")
)

type ReportCatalog interface {
	GetReportDefinition(ctx context.Context, id string) (*model.ReportDefinition, error)
	GetReportDataSource(ctx context.Context, id string) (*model.ReportDataSource, error)
}

type ReportRunStore interface {
	StartReportRun(ctx context.Context, run *model.ReportRun) error
	CompleteReportRun(ctx context.Context, run *model.ReportRun) error
	FailReportRun(ctx context.Context, run *model.ReportRun) error
}

type ReportConnector interface {
	Query(ctx context.Context, source model.ReportDataSource, query []byte) (model.ReportQueryResult, error)
}

type ReportAnalyticsStore interface {
	UpsertReportDailyAnalytics(ctx context.Context, row *model.ReportDailyAnalytics) error
	ListReportDailyAnalytics(ctx context.Context, reportID, startDate, endDate string) ([]model.ReportDailyAnalytics, error)
}

// ReportAnalyticsOptions scopes an aggregate query without changing the fixed report definition.
// City-filtered views bypass the shared daily cache because that cache represents all cities.
type ReportAnalyticsOptions struct {
	Cities       []string
	ForceRefresh bool
}

// ReportRunner 将数据查询、快照和运行状态隐藏在一个稳定接口后。
type ReportRunner struct {
	catalog   ReportCatalog
	runs      ReportRunStore
	connector ReportConnector
	analytics ReportAnalyticsStore
	now       func() time.Time
}

func NewReportRunner(catalog ReportCatalog, runs ReportRunStore, connector ReportConnector, analytics ...ReportAnalyticsStore) *ReportRunner {
	runner := &ReportRunner{catalog: catalog, runs: runs, connector: connector, now: time.Now}
	if len(analytics) > 0 {
		runner.analytics = analytics[0]
	}
	return runner
}

func (r *ReportRunner) resolve(ctx context.Context, reportID string) (*model.ReportDefinition, *model.ReportDataSource, error) {
	report, err := r.catalog.GetReportDefinition(ctx, reportID)
	if err != nil {
		return nil, nil, fmt.Errorf("get report definition: %w", err)
	}
	if report == nil {
		return nil, nil, ErrReportNotFound
	}
	source, err := r.catalog.GetReportDataSource(ctx, report.DataSourceID)
	if err != nil {
		return nil, nil, fmt.Errorf("get report data source: %w", err)
	}
	if source == nil {
		return nil, nil, ErrReportSourceMissing
	}
	return report, source, nil
}

// QueryPage 基于固定报表配置覆盖页码后按需查询，避免把整张用户表载入浏览器。
func (r *ReportRunner) QueryPage(ctx context.Context, reportID string, page, pageSize int) (*model.ReportPageResult, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	report, source, err := r.resolve(ctx, reportID)
	if err != nil {
		return nil, err
	}
	var query map[string]any
	if err := json.Unmarshal(report.QueryJSON, &query); err != nil {
		return nil, fmt.Errorf("parse report query: %w", err)
	}
	query["needPagination"] = true
	query["page"] = page
	query["pageSize"] = pageSize
	if value, _ := query["orderBy"].(string); value == "" {
		query["orderBy"] = "duid"
	}
	payload, err := json.Marshal(query)
	if err != nil {
		return nil, fmt.Errorf("encode paged report query: %w", err)
	}
	result, err := r.connector.Query(ctx, *source, payload)
	if err != nil {
		return nil, err
	}
	return &model.ReportPageResult{
		Rows: result.Rows, Pagination: result.Pagination, SourcePartition: result.Partition,
		QueryID: result.QueryID, DurationMS: result.Duration.Milliseconds(),
	}, nil
}

// QuerySearch 只允许按完整 DUID 精确查询，供普通用户查询单个用户而不开放全表浏览。
func (r *ReportRunner) QuerySearch(ctx context.Context, reportID, rawDUID string) (*model.ReportPageResult, error) {
	duid := strings.TrimSpace(rawDUID)
	if duid == "" || len(duid) > 32 {
		return nil, fmt.Errorf("%w: 请输入完整 DUID", ErrReportInvalid)
	}
	for _, ch := range duid {
		if ch < '0' || ch > '9' {
			return nil, fmt.Errorf("%w: DUID 只能包含数字", ErrReportInvalid)
		}
	}
	report, source, err := r.resolve(ctx, reportID)
	if err != nil {
		return nil, err
	}
	var query map[string]any
	if err := json.Unmarshal(report.QueryJSON, &query); err != nil {
		return nil, fmt.Errorf("parse report query: %w", err)
	}
	conditions, _ := query["conditionList"].([]any)
	conditions = append(conditions, map[string]any{"name": "duid", "operatorEnum": "EQ", "value": duid})
	query["conditionList"] = conditions
	query["needPagination"] = true
	query["page"] = 1
	query["pageSize"] = 20
	query["orderBy"] = "duid"
	payload, err := json.Marshal(query)
	if err != nil {
		return nil, fmt.Errorf("encode report search query: %w", err)
	}
	result, err := r.connector.Query(ctx, *source, payload)
	if err != nil {
		return nil, err
	}
	return &model.ReportPageResult{
		Rows: result.Rows, Pagination: result.Pagination, SourcePartition: result.Partition,
		QueryID: result.QueryID, DurationMS: result.Duration.Milliseconds(),
	}, nil
}

func analyticsField(name, alias, aggregate string) map[string]any {
	field := map[string]any{"name": name}
	if alias != "" {
		field["alias"] = alias
	}
	if aggregate != "" {
		field["aggFunctionEnum"] = aggregate
	}
	return field
}

func analyticsNumber(row map[string]any, key string) float64 {
	value, ok := row[key]
	if !ok || value == nil {
		return 0
	}
	switch typed := value.(type) {
	case json.Number:
		number, _ := typed.Float64()
		return number
	case float64:
		return typed
	case float32:
		return float64(typed)
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	default:
		number, _ := strconv.ParseFloat(fmt.Sprint(value), 64)
		return number
	}
}

// QueryAnalytics 对已算出价敏分的用户做固定聚合，避免把用户明细当作趋势数据。
func (r *ReportRunner) QueryAnalytics(ctx context.Context, reportID, rangeKey, endDate string, options ...ReportAnalyticsOptions) (*model.ReportAnalyticsResult, error) {
	daysByRange := map[string]int{"1d": 1, "7d": 7, "30d": 30, "31d": 31, "180d": 180, "365d": 365}
	days, ok := daysByRange[rangeKey]
	if !ok {
		return nil, fmt.Errorf("%w: 不支持的时间范围", ErrReportInvalid)
	}
	if strings.TrimSpace(endDate) == "" {
		endDate = r.now().AddDate(0, 0, -1).Format("2006-01-02")
	}
	end, err := time.Parse("2006-01-02", endDate)
	if err != nil {
		return nil, fmt.Errorf("%w: 数据分区日期无效", ErrReportInvalid)
	}
	startDate := end.AddDate(0, 0, -(days - 1)).Format("2006-01-02")
	_, source, err := r.resolve(ctx, reportID)
	if err != nil {
		return nil, err
	}
	base := &model.ReportAnalyticsResult{Range: rangeKey, StartDate: startDate, EndDate: endDate}
	var option ReportAnalyticsOptions
	if len(options) > 0 {
		option = options[0]
	}
	cities := normalizeAnalyticsCities(option.Cities)
	if len(cities) > 50 {
		return nil, fmt.Errorf("%w: 城市筛选最多支持 50 项", ErrReportInvalid)
	}
	useSharedCache := len(cities) == 0
	var cachedRows []model.ReportDailyAnalytics
	if r.analytics != nil && useSharedCache && !option.ForceRefresh {
		dailyRows, listErr := r.analytics.ListReportDailyAnalytics(ctx, reportID, startDate, endDate)
		if listErr != nil {
			return nil, fmt.Errorf("list daily report analytics: %w", listErr)
		}
		cachedRows = dailyRows
		if dailyAnalyticsCoverRange(cachedRows, startDate, endDate) {
			cached := mergeDailyAnalytics(base, cachedRows)
			cached.Cached = true
			return deriveIncrementAnalytics(cached), nil
		}
	}
	latestDateConditions := []map[string]any{
		{"name": "dt", "operatorEnum": "EQ", "value": endDate},
	}
	calculatedLatestConditions := []map[string]any{
		{"name": "price_sensitivity_score", "operatorEnum": "NOT_NULL"},
		{"name": "dt", "operatorEnum": "EQ", "value": endDate},
	}
	calculatedRangeConditions := []map[string]any{
		{"name": "price_sensitivity_score", "operatorEnum": "NOT_NULL"},
		{"name": "dt", "operatorEnum": "GEQ", "value": startDate},
		{"name": "dt", "operatorEnum": "LEQ", "value": endDate},
	}
	latestDateConditions = appendAnalyticsCityCondition(latestDateConditions, cities)
	calculatedLatestConditions = appendAnalyticsCityCondition(calculatedLatestConditions, cities)
	calculatedRangeConditions = appendAnalyticsCityCondition(calculatedRangeConditions, cities)
	queries := []map[string]any{
		{
			"fieldList": []map[string]any{
				analyticsField("duid", "total_user_count", "COUNT_DISTINCT"),
				analyticsField("d1_recent_order_count", "total_order_count", "SUM"),
			},
			"conditionList": latestDateConditions, "groupList": []string{}, "needPagination": false,
		},
		{
			"fieldList": []map[string]any{
				analyticsField("price_sensitivity_score", "avg_price_sensitivity_score", "AVG"),
				analyticsField("duid", "calculated_user_count", "COUNT_DISTINCT"),
			},
			"conditionList": calculatedLatestConditions, "groupList": []string{}, "needPagination": false,
		},
		{
			"fieldList": []map[string]any{
				analyticsField("dt", "", ""),
				analyticsField("price_sensitivity_score", "avg_price_sensitivity_score", "AVG"),
				analyticsField("d1_price_score", "avg_d1_price_score", "AVG"),
				analyticsField("d2_coupon_score", "avg_d2_coupon_score", "AVG"),
				analyticsField("d3_time_score", "avg_d3_time_score", "AVG"),
				analyticsField("d1_recent_order_count", "total_order_count", "SUM"),
				analyticsField("duid", "calculated_user_count", "COUNT_DISTINCT"),
			},
			"conditionList": calculatedRangeConditions, "groupList": []string{"dt"}, "orderBy": "dt", "needPagination": false,
		},
		{
			"fieldList": []map[string]any{
				analyticsField("dt", "", ""),
				analyticsField("price_sensitivity_level", "", ""),
				analyticsField("duid", "user_count", "COUNT_DISTINCT"),
			},
			"conditionList": calculatedRangeConditions, "groupList": []string{"dt", "price_sensitivity_level"}, "orderBy": "dt", "needPagination": false,
		},
	}
	results := make([]model.ReportQueryResult, 0, len(queries))
	for _, query := range queries {
		payload, marshalErr := json.Marshal(query)
		if marshalErr != nil {
			return nil, fmt.Errorf("encode analytics query: %w", marshalErr)
		}
		result, queryErr := r.connector.Query(ctx, *source, payload)
		if queryErr != nil {
			if len(cachedRows) > 0 {
				cached := mergeDailyAnalytics(base, cachedRows)
				cached.Cached = true
				return deriveIncrementAnalytics(cached), nil
			}
			return nil, queryErr
		}
		results = append(results, result)
	}
	response := base
	for _, result := range results {
		response.DurationMS += result.Duration.Milliseconds()
	}
	if len(results[0].Rows) > 0 {
		row := results[0].Rows[0]
		response.Summary.TotalUserCount = int64(analyticsNumber(row, "total_user_count"))
		response.Summary.TotalOrderCount = int64(analyticsNumber(row, "total_order_count"))
	}
	if len(results[1].Rows) > 0 {
		row := results[1].Rows[0]
		response.Summary.AveragePriceSensitivityScore = analyticsNumber(row, "avg_price_sensitivity_score")
		response.Summary.CalculatedUserCount = int64(analyticsNumber(row, "calculated_user_count"))
	}
	if response.Summary.TotalUserCount > 0 {
		response.Summary.CalculatedUserShare = float64(response.Summary.CalculatedUserCount) / float64(response.Summary.TotalUserCount) * 100
	}
	for _, row := range results[2].Rows {
		response.Trend = append(response.Trend, model.ReportAnalyticsTrendPoint{
			Date: fmt.Sprint(row["dt"]), AveragePriceSensitivityScore: analyticsNumber(row, "avg_price_sensitivity_score"),
			AverageD1PriceScore: analyticsNumber(row, "avg_d1_price_score"), AverageD2CouponScore: analyticsNumber(row, "avg_d2_coupon_score"),
			AverageD3TimeScore: analyticsNumber(row, "avg_d3_time_score"), TotalOrderCount: int64(analyticsNumber(row, "total_order_count")),
			CalculatedUserCount: int64(analyticsNumber(row, "calculated_user_count")),
		})
	}
	sort.Slice(response.Trend, func(i, j int) bool { return response.Trend[i].Date < response.Trend[j].Date })
	distributionByDate := make(map[string][]model.ReportAnalyticsDistribution)
	for _, row := range results[3].Rows {
		item := model.ReportAnalyticsDistribution{Level: fmt.Sprint(row["price_sensitivity_level"]), UserCount: int64(analyticsNumber(row, "user_count"))}
		distributionByDate[fmt.Sprint(row["dt"])] = append(distributionByDate[fmt.Sprint(row["dt"])], item)
	}
	response.Distribution = append(response.Distribution, distributionByDate[endDate]...)
	var distributionTotal int64
	for _, item := range response.Distribution {
		distributionTotal += item.UserCount
		if item.Level == "HIGH" {
			response.Summary.HighSensitivityShare = float64(item.UserCount)
		} else if item.Level == "MEDIUM" {
			response.Summary.MediumSensitivityShare = float64(item.UserCount)
		} else if item.Level == "LOW" {
			response.Summary.LowSensitivityShare = float64(item.UserCount)
		}
	}
	sort.Slice(response.Distribution, func(i, j int) bool { return response.Distribution[i].Level < response.Distribution[j].Level })
	if distributionTotal > 0 {
		response.Summary.HighSensitivityShare = response.Summary.HighSensitivityShare / float64(distributionTotal) * 100
		response.Summary.MediumSensitivityShare = response.Summary.MediumSensitivityShare / float64(distributionTotal) * 100
		response.Summary.LowSensitivityShare = response.Summary.LowSensitivityShare / float64(distributionTotal) * 100
	}
	if r.analytics != nil && useSharedCache {
		for _, point := range response.Trend {
			distribution, _ := json.Marshal(distributionByDate[point.Date])
			row := &model.ReportDailyAnalytics{
				ReportID: reportID, Date: point.Date, AveragePriceSensitivityScore: point.AveragePriceSensitivityScore,
				AverageD1PriceScore: point.AverageD1PriceScore, AverageD2CouponScore: point.AverageD2CouponScore,
				AverageD3TimeScore: point.AverageD3TimeScore, TotalUserCount: response.Summary.TotalUserCount, TotalOrderCount: point.TotalOrderCount,
				CalculatedUserCount: point.CalculatedUserCount, DistributionJSON: distribution,
			}
			if err := r.analytics.UpsertReportDailyAnalytics(ctx, row); err != nil {
				return nil, fmt.Errorf("store daily report analytics: %w", err)
			}
		}
		dailyRows, err := r.analytics.ListReportDailyAnalytics(ctx, reportID, startDate, endDate)
		if err != nil {
			return nil, fmt.Errorf("list daily report analytics: %w", err)
		}
		if dailyAnalyticsCoverRange(dailyRows, startDate, endDate) {
			return deriveIncrementAnalytics(mergeDailyAnalytics(response, dailyRows)), nil
		}
	}
	return deriveIncrementAnalytics(response), nil
}

// deriveIncrementAnalytics turns ordered rolling-window snapshots into honest
// day-over-day net changes. It deliberately calls the result "net growth": a
// true first-time/entry/exit split requires a DUID lifecycle fact upstream.
func deriveIncrementAnalytics(result *model.ReportAnalyticsResult) *model.ReportAnalyticsResult {
	if result == nil || len(result.Trend) == 0 {
		return result
	}
	sort.Slice(result.Trend, func(i, j int) bool { return result.Trend[i].Date < result.Trend[j].Date })
	baseline := result.Trend[0].CalculatedUserCount
	result.Summary.BaselineCalculatedUserCount = baseline
	var netGrowthTotal int64
	for index := range result.Trend {
		point := &result.Trend[index]
		point.CumulativeNetUserGrowth = point.CalculatedUserCount - baseline
		if index == 0 {
			point.DailyNetUserGrowth = 0
			point.DailyUserGrowthRate = 0
			continue
		}
		previous := result.Trend[index-1].CalculatedUserCount
		point.DailyNetUserGrowth = point.CalculatedUserCount - previous
		netGrowthTotal += point.DailyNetUserGrowth
		if previous > 0 {
			point.DailyUserGrowthRate = float64(point.DailyNetUserGrowth) / float64(previous) * 100
		}
	}
	latest := result.Trend[len(result.Trend)-1]
	result.Summary.LatestDailyNetUserGrowth = latest.DailyNetUserGrowth
	result.Summary.CumulativeNetUserGrowth = latest.CumulativeNetUserGrowth
	result.Summary.LatestUserGrowthRate = latest.DailyUserGrowthRate
	if len(result.Trend) > 1 {
		result.Summary.AverageDailyNetUserGrowth = float64(netGrowthTotal) / float64(len(result.Trend)-1)
	}
	return result
}

func dailyAnalyticsCoverRange(rows []model.ReportDailyAnalytics, startDate, endDate string) bool {
	start, startErr := time.Parse("2006-01-02", startDate)
	end, endErr := time.Parse("2006-01-02", endDate)
	if len(rows) == 0 || startErr != nil || endErr != nil || end.Before(start) {
		return false
	}
	dates := make(map[string]bool, len(rows))
	for _, row := range rows {
		dates[row.Date] = true
	}
	for date := start; !date.After(end); date = date.AddDate(0, 0, 1) {
		if !dates[date.Format("2006-01-02")] {
			return false
		}
	}
	return true
}

func normalizeAnalyticsCities(cities []string) []string {
	normalized := make([]string, 0, len(cities))
	seen := make(map[string]bool, len(cities))
	for _, city := range cities {
		city = strings.TrimSpace(city)
		if city == "" || seen[city] {
			continue
		}
		seen[city] = true
		normalized = append(normalized, city)
	}
	return normalized
}

func appendAnalyticsCityCondition(conditions []map[string]any, cities []string) []map[string]any {
	if len(cities) == 0 {
		return conditions
	}
	return append(conditions, map[string]any{"name": "user_city_name", "operatorEnum": "IN", "value": cities})
}

func mergeDailyAnalytics(base *model.ReportAnalyticsResult, rows []model.ReportDailyAnalytics) *model.ReportAnalyticsResult {
	merged := &model.ReportAnalyticsResult{Range: base.Range, StartDate: base.StartDate, EndDate: base.EndDate, DurationMS: base.DurationMS}
	for _, row := range rows {
		merged.Trend = append(merged.Trend, model.ReportAnalyticsTrendPoint{
			Date: row.Date, AveragePriceSensitivityScore: row.AveragePriceSensitivityScore,
			AverageD1PriceScore: row.AverageD1PriceScore, AverageD2CouponScore: row.AverageD2CouponScore,
			AverageD3TimeScore: row.AverageD3TimeScore, TotalOrderCount: row.TotalOrderCount,
			CalculatedUserCount: row.CalculatedUserCount,
		})
	}
	latest := rows[len(rows)-1]
	merged.Summary.AveragePriceSensitivityScore = latest.AveragePriceSensitivityScore
	merged.Summary.TotalUserCount = latest.TotalUserCount
	merged.Summary.TotalOrderCount = latest.TotalOrderCount
	merged.Summary.CalculatedUserCount = latest.CalculatedUserCount
	if base.Summary.TotalUserCount > 0 {
		merged.Summary = base.Summary
	}
	if merged.Summary.TotalUserCount > 0 {
		merged.Summary.CalculatedUserShare = float64(merged.Summary.CalculatedUserCount) / float64(merged.Summary.TotalUserCount) * 100
	}
	_ = json.Unmarshal(latest.DistributionJSON, &merged.Distribution)
	var distributionTotal int64
	for _, item := range merged.Distribution {
		distributionTotal += item.UserCount
		if item.Level == "HIGH" {
			merged.Summary.HighSensitivityShare = float64(item.UserCount)
		} else if item.Level == "MEDIUM" {
			merged.Summary.MediumSensitivityShare = float64(item.UserCount)
		} else if item.Level == "LOW" {
			merged.Summary.LowSensitivityShare = float64(item.UserCount)
		}
	}
	if distributionTotal > 0 {
		merged.Summary.HighSensitivityShare = merged.Summary.HighSensitivityShare / float64(distributionTotal) * 100
		merged.Summary.MediumSensitivityShare = merged.Summary.MediumSensitivityShare / float64(distributionTotal) * 100
		merged.Summary.LowSensitivityShare = merged.Summary.LowSensitivityShare / float64(distributionTotal) * 100
	}
	sort.Slice(merged.Trend, func(i, j int) bool { return merged.Trend[i].Date < merged.Trend[j].Date })
	sort.Slice(merged.Distribution, func(i, j int) bool { return merged.Distribution[i].Level < merged.Distribution[j].Level })
	return merged
}

func (r *ReportRunner) Run(ctx context.Context, reportID, trigger, requestedBy string) (*model.ReportRun, error) {
	report, source, err := r.resolve(ctx, reportID)
	if err != nil {
		return nil, err
	}
	run := &model.ReportRun{ID: uuid.NewString(), ReportID: report.ID, Trigger: trigger, Status: model.ReportRunPending, RequestedBy: requestedBy, StartedAt: r.now()}
	if err := r.runs.StartReportRun(ctx, run); err != nil {
		return nil, fmt.Errorf("start report run: %w", err)
	}
	result, queryErr := r.connector.Query(ctx, *source, report.QueryJSON)
	finished := r.now()
	run.FinishedAt = &finished
	if queryErr != nil {
		run.Status = model.ReportRunFailed
		run.ErrorMessage = queryErr.Error()
		if err := r.runs.FailReportRun(ctx, run); err != nil {
			return nil, fmt.Errorf("persist failed report run: %w", err)
		}
		return run, queryErr
	}
	snapshot, err := json.Marshal(result.Rows)
	if err != nil {
		return nil, fmt.Errorf("encode report snapshot: %w", err)
	}
	run.Status = model.ReportRunSucceeded
	run.SnapshotJSON = snapshot
	run.SourcePartition = result.Partition
	run.QueryID = result.QueryID
	run.DurationMS = result.Duration.Milliseconds()
	if err := r.runs.CompleteReportRun(ctx, run); err != nil {
		return nil, fmt.Errorf("complete report run: %w", err)
	}
	var visualization struct {
		Analytics struct {
			Enabled bool `json:"enabled"`
		} `json:"analytics"`
	}
	_ = json.Unmarshal(report.VisualizationJSON, &visualization)
	if r.analytics != nil && visualization.Analytics.Enabled && result.Partition != "" {
		analyticsRange := "1d"
		if trigger == "manual" {
			// 手动运行用于接住上游历史回刷；定时任务仍只积累最新日点。
			analyticsRange = "31d"
		}
		_, _ = r.QueryAnalytics(ctx, reportID, analyticsRange, result.Partition, ReportAnalyticsOptions{ForceRefresh: true})
	}
	return run, nil
}
