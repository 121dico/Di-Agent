package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"time"
)

func v12SnapshotKey(report *model.ReportDefinition, source *model.ReportDataSource, base *model.ReportAnalyticsResult, cities []string) string {
	raw, _ := json.Marshal([]any{"v12-daily-snapshot-4", report.ID, report.UpdatedAt, source.UpdatedAt, report.VisualizationJSON, report.QueryJSON, base.Range, base.StartDate, base.EndDate, cities})
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:])
}

// Saved history is a persisted report, not a new upstream query. Existing source
// and field authorization is checked by queryV12Analytics before entering here.
func (r *ReportRunner) savedV12History(ctx context.Context, report *model.ReportDefinition, source *model.ReportDataSource, base *model.ReportAnalyticsResult, cities []string) (*model.ReportAnalyticsResult, error) {
	result := &model.ReportAnalyticsResult{Range: "all", Profile: "price_sensitive_v1_2", StartDate: base.StartDate, EndDate: base.EndDate, Cached: true, Trend: []model.ReportAnalyticsTrendPoint{}, Distribution: []model.ReportAnalyticsDistribution{}}
	cache, ok := r.catalog.(reportTemplateAnalyticsStore)
	if !ok {
		return result, nil
	}
	start, _ := time.Parse("2006-01-02", base.StartDate)
	end, _ := time.Parse("2006-01-02", base.EndDate)
	if end.Sub(start) > 1000*24*time.Hour {
		return nil, fmt.Errorf("%w: 历史目录超过1000天", ErrReportInvalid)
	}
	for date := start; !date.After(end); date = date.AddDate(0, 0, 1) {
		day := date.Format("2006-01-02")
		key := v12SnapshotKey(report, source, &model.ReportAnalyticsResult{Range: "1d", StartDate: day, EndDate: day}, cities)
		// Expiry controls live query reuse; saved reports remain readable until their
		// report/source configuration changes or explicit invalidation removes them.
		saved, err := cache.GetTemplateAnalytics(ctx, key, time.Time{})
		if err != nil {
			return nil, err
		}
		if saved == nil || saved.DataDate != day {
			continue
		}
		for _, point := range saved.Trend {
			if point.Date == day {
				result.Trend = append(result.Trend, point)
			}
		}
		result.AvailableDates = append(result.AvailableDates, day)
		result.DataDate = day
		result.Summary = saved.Summary
		result.Distribution = saved.Distribution
		result.OrderCohort = saved.OrderCohort
		result.FetchedAt = saved.FetchedAt
		result.CountingBasis = saved.CountingBasis
		result.QueryIDs = append(result.QueryIDs, saved.QueryIDs...)
	}
	if result.DataDate != "" {
		result.EndDate = result.DataDate
	}
	return result, nil
}
