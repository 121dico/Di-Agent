package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func (r *ReportRepo) GetStationValidation(ctx context.Context, key string, now time.Time) (*model.StationValidationResult, error) {
	var raw []byte
	err := r.db.GetContext(ctx, &raw, `SELECT result_json FROM report_template_analytics_cache WHERE cache_key=$1 AND expires_at>$2`, key, now)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read station validation: %w", err)
	}
	var result model.StationValidationResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("decode station validation: %w", err)
	}
	return &result, nil
}

func (r *ReportRepo) SaveStationValidation(ctx context.Context, key, reportID string, result *model.StationValidationResult, expires time.Time) error {
	raw, err := json.Marshal(result)
	if err != nil {
		return fmt.Errorf("encode station validation: %w", err)
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO report_template_analytics_cache(cache_key,report_id,result_json,expires_at) VALUES($1,$2,$3,$4)
		ON CONFLICT(cache_key) DO UPDATE SET result_json=EXCLUDED.result_json,expires_at=EXCLUDED.expires_at`, key, reportID, raw, expires)
	return wrapReportRepoErr("save station validation", err)
}
