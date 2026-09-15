package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func (r *ReportRepo) GetSourceTimeCoverage(ctx context.Context, id string) (*model.ReportSourceTimeCoverage, error) {
	var raw []byte
	err := r.db.GetContext(ctx, &raw, `SELECT coverage FROM report_source_time_coverage WHERE source_id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get source time coverage: %w", err)
	}
	var v model.ReportSourceTimeCoverage
	if err = json.Unmarshal(raw, &v); err != nil {
		return nil, fmt.Errorf("decode source time coverage: %w", err)
	}
	return &v, nil
}
func (r *ReportRepo) SaveSourceTimeCoverage(ctx context.Context, v *model.ReportSourceTimeCoverage) error {
	raw, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("encode source time coverage: %w", err)
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO report_source_time_coverage(source_id,coverage) VALUES($1,$2::jsonb) ON CONFLICT(source_id) DO UPDATE SET coverage=EXCLUDED.coverage,updated_at=now()`, v.SourceID, string(raw))
	if err != nil {
		return fmt.Errorf("save source time coverage: %w", err)
	}
	return nil
}
