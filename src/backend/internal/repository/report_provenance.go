package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func (r *ReportRepo) AppendReportQueryExecution(ctx context.Context, execution *model.ReportQueryExecution) error {
	raw, err := json.Marshal(execution)
	if err != nil {
		return err
	}
	_, err = r.db.ExecContext(ctx, `INSERT INTO report_query_executions (id, report_id, source_id, query_key, payload_json, created_at) VALUES ($1,$2,$3,$4,$5,$6)`, execution.ID, execution.ReportID, execution.SourceID, execution.QueryKey, raw, execution.CreatedAt)
	return wrapReportRepoErr("append report query execution", err)
}

func (r *ReportRepo) ListReportQueryExecutions(ctx context.Context, reportID string, limit int) ([]model.ReportQueryExecution, error) {
	if limit < 1 || limit > 200 {
		limit = 200
	}
	rows, err := r.db.QueryxContext(ctx, `SELECT payload_json FROM report_query_executions WHERE report_id=$1 ORDER BY created_at DESC,id DESC LIMIT $2`, reportID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []model.ReportQueryExecution{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item model.ReportQueryExecution
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (r *ReportRepo) GetReportQueryExecution(ctx context.Context, reportID, id string) (*model.ReportQueryExecution, error) {
	var raw []byte
	err := r.db.QueryRowxContext(ctx, `SELECT payload_json FROM report_query_executions WHERE report_id=$1 AND id=$2`, reportID, id).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var result model.ReportQueryExecution
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, err
	}
	return &result, nil
}
