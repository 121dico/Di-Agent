package repository

import (
	"context"
	"encoding/json"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"time"
)

func (r *ReportRepo) ListPreparedReportDays(ctx context.Context, prefix string) ([]model.ReportPreparedDay, error) {
	var rows [][]byte
	err := r.db.SelectContext(ctx, &rows, `SELECT result_json FROM report_template_analytics_cache WHERE cache_key LIKE $1 ORDER BY cache_key LIMIT 1001`, prefix+"%")
	if err != nil {
		return nil, wrapReportRepoErr("list prepared report", err)
	}
	result := make([]model.ReportPreparedDay, 0, len(rows))
	for _, raw := range rows {
		var day model.ReportPreparedDay
		if err := json.Unmarshal(raw, &day); err != nil {
			return nil, err
		}
		result = append(result, day)
	}
	return result, nil
}

func (r *ReportRepo) SavePreparedReportDay(ctx context.Context, prefix, reportID string, day *model.ReportPreparedDay) error {
	raw, err := json.Marshal(day)
	if err != nil {
		return err
	}
	// 一条 UPSERT 发布一个完整日期，未完成的计算不会覆盖旧版。
	_, err = r.db.ExecContext(ctx, `INSERT INTO report_template_analytics_cache(cache_key,report_id,result_json,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(cache_key) DO UPDATE SET result_json=EXCLUDED.result_json,expires_at=EXCLUDED.expires_at`, prefix+day.Date, reportID, raw, time.Date(9999, 1, 1, 0, 0, 0, 0, time.UTC))
	return wrapReportRepoErr("save prepared report", err)
}
