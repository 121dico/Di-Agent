package service

import (
	"fmt"
	"sort"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type v12DailyAggregate struct {
	point      model.ReportAnalyticsTrendPoint
	totalUsers int64
	weighted   map[string]float64
	samples    map[string]float64
	levels     map[string]int64
	types      map[string]int64
}

func assembleV12Analytics(base *model.ReportAnalyticsResult, results []model.ReportQueryResult, now time.Time) *model.ReportAnalyticsResult {
	result := &model.ReportAnalyticsResult{Range: base.Range, StartDate: base.StartDate, EndDate: base.EndDate, Profile: "price_sensitive_v1_2", FetchedAt: now.UTC().Format(time.RFC3339), AssignedByType: map[string]int64{}, Trend: []model.ReportAnalyticsTrendPoint{}, Distribution: []model.ReportAnalyticsDistribution{}}
	days := map[string]*v12DailyAggregate{}
	for _, row := range results[0].Rows {
		date := fmt.Sprint(row["dt"])
		days[date] = &v12DailyAggregate{point: model.ReportAnalyticsTrendPoint{Date: date, TotalOrderCount: int64(analyticsNumber(row, "total_order_count")), NullableScores: map[string]*float64{"price": nil, "d1": nil, "d2": nil, "d3": nil}}, totalUsers: int64(analyticsNumber(row, "total_user_count")), weighted: map[string]float64{}, samples: map[string]float64{}, levels: map[string]int64{}, types: map[string]int64{}}
	}
	for _, row := range results[1].Rows {
		day := days[fmt.Sprint(row["dt"])]
		if day == nil {
			continue
		}
		count := int64(analyticsNumber(row, "user_count"))
		day.point.CalculatedUserCount += count
		level, _ := row["level"].(string)
		if level == "" {
			level = "UNKNOWN"
		}
		kind, _ := row["score_type"].(string)
		if kind == "" {
			kind = "UNKNOWN"
		}
		day.levels[level] += count
		day.types[kind] += count
		for _, key := range []string{"price", "d1", "d2", "d3"} {
			if row[key+"_avg"] == nil {
				continue
			}
			n := analyticsNumber(row, key+"_n")
			day.weighted[key] += analyticsNumber(row, key+"_avg") * n
			day.samples[key] += n
		}
	}
	for _, day := range days {
		for _, key := range []string{"price", "d1", "d2", "d3"} {
			if day.samples[key] > 0 {
				value := day.weighted[key] / day.samples[key]
				day.point.NullableScores[key] = &value
			}
		}
		values := day.point.NullableScores
		if values["price"] != nil {
			day.point.AveragePriceSensitivityScore = *values["price"]
		}
		if values["d1"] != nil {
			day.point.AverageD1PriceScore = *values["d1"]
		}
		if values["d2"] != nil {
			day.point.AverageD2CouponScore = *values["d2"]
		}
		if values["d3"] != nil {
			day.point.AverageD3TimeScore = *values["d3"]
		}
		result.Trend = append(result.Trend, day.point)
	}
	sort.Slice(result.Trend, func(i, j int) bool { return result.Trend[i].Date < result.Trend[j].Date })
	if len(result.Trend) > 0 {
		latest := days[result.Trend[len(result.Trend)-1].Date]
		result.DataDate = latest.point.Date
		result.Summary.TotalUserCount = latest.totalUsers
		result.Summary.TotalOrderCount = latest.point.TotalOrderCount
		result.Summary.CalculatedUserCount = latest.point.CalculatedUserCount
		result.Summary.AveragePriceSensitivityScore = latest.point.AveragePriceSensitivityScore
		if latest.totalUsers > 0 {
			result.Summary.CalculatedUserShare = float64(latest.point.CalculatedUserCount) / float64(latest.totalUsers) * 100
		}
		for _, level := range []string{"VERY_HIGH", "HIGH", "MEDIUM", "LOW", "VERY_LOW", "UNKNOWN"} {
			if count, ok := latest.levels[level]; ok {
				result.Distribution = append(result.Distribution, model.ReportAnalyticsDistribution{Level: level, UserCount: count})
			}
		}
		// 未来上游增加新档位时仍保留数值，不丢到不可见分母里。
		for level, count := range latest.levels {
			if level != "VERY_HIGH" && level != "HIGH" && level != "MEDIUM" && level != "LOW" && level != "VERY_LOW" && level != "UNKNOWN" {
				result.Distribution = append(result.Distribution, model.ReportAnalyticsDistribution{Level: level, UserCount: count})
			}
		}
		if latest.point.CalculatedUserCount > 0 {
			denominator := float64(latest.point.CalculatedUserCount)
			result.Summary.HighSensitivityShare = float64(latest.levels["HIGH"]+latest.levels["VERY_HIGH"]) / denominator * 100
			result.Summary.MediumSensitivityShare = float64(latest.levels["MEDIUM"]+latest.levels["MEDIUM_HIGH"]+latest.levels["MEDIUM_LOW"]) / denominator * 100
			result.Summary.LowSensitivityShare = float64(latest.levels["LOW"]+latest.levels["VERY_LOW"]) / denominator * 100
		}
		result.AssignedByType = latest.types
	}
	start, _ := time.Parse("2006-01-02", base.StartDate)
	end, _ := time.Parse("2006-01-02", base.EndDate)
	for date := start; !date.After(end); date = date.AddDate(0, 0, 1) {
		key := date.Format("2006-01-02")
		if days[key] == nil {
			result.MissingDates = append(result.MissingDates, key)
		}
	}
	for _, response := range results {
		result.DurationMS += response.Duration.Milliseconds()
		if response.QueryID != "" {
			result.QueryIDs = append(result.QueryIDs, response.QueryID)
		}
	}
	deriveIncrementAnalytics(result)
	var sum int64
	var consecutive int
	for index := range result.Trend {
		point := &result.Trend[index]
		available := true
		if index > 0 {
			previous, _ := time.Parse("2006-01-02", result.Trend[index-1].Date)
			available = previous.AddDate(0, 0, 1).Format("2006-01-02") == point.Date
			if available {
				sum += point.DailyNetUserGrowth
				consecutive++
			} else {
				point.DailyNetUserGrowth = 0
				point.DailyUserGrowthRate = 0
			}
		}
		point.DailyGrowthAvailable = &available
	}
	result.Summary.AverageDailyNetUserGrowth = 0
	if consecutive > 0 {
		result.Summary.AverageDailyNetUserGrowth = float64(sum) / float64(consecutive)
	}
	if len(result.Trend) > 0 {
		last := result.Trend[len(result.Trend)-1]
		result.Summary.LatestDailyNetUserGrowth = last.DailyNetUserGrowth
		result.Summary.LatestUserGrowthRate = last.DailyUserGrowthRate
	}
	return result
}
