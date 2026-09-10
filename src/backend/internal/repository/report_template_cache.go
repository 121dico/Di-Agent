package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func (r *ReportRepo) GetTemplateAnalytics(ctx context.Context, key string, now time.Time) (*model.ReportAnalyticsResult, error) {
	var raw []byte
	err := r.db.GetContext(ctx, &raw, `SELECT result_json FROM report_template_analytics_cache WHERE cache_key=$1 AND expires_at>$2`, key, now)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, wrapReportRepoErr("get template analytics", err)
	}
	var result model.ReportAnalyticsResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (r *ReportRepo) SaveTemplateAnalytics(ctx context.Context, key, reportID string, result *model.ReportAnalyticsResult, expires time.Time) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO report_template_analytics_cache(cache_key,report_id,result_json,expires_at)
		VALUES($1,$2,$3,$4) ON CONFLICT(cache_key) DO UPDATE SET result_json=EXCLUDED.result_json, expires_at=EXCLUDED.expires_at`, key, reportID, raw, expires)
	return wrapReportRepoErr("save template analytics", err)
}

func (r *ReportRepo) InvalidateTemplateAnalytics(ctx context.Context, reportID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM report_template_analytics_cache WHERE report_id=$1 OR expires_at<NOW()`, reportID)
	return wrapReportRepoErr("invalidate template analytics", err)
}
