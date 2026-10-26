package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/jmoiron/sqlx"
)

type ReportAgentReceiptRepo struct{ db *sqlx.DB }

func NewReportAgentReceiptRepo(db *sqlx.DB) *ReportAgentReceiptRepo {
	return &ReportAgentReceiptRepo{db: db}
}

func (r *ReportAgentReceiptRepo) Create(ctx context.Context, receipt *model.ReportAgentQueryReceipt) error {
	err := r.db.QueryRowxContext(ctx, `INSERT INTO report_agent_query_receipts
		(owner_user_id, source_id, source_name, request_json, rows_json, pagination_json,
		 source_partition, upstream_query_id, duration_ms)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
		receipt.OwnerUserID, receipt.SourceID, receipt.SourceName, receipt.RequestJSON,
		receipt.RowsJSON, receipt.PaginationJSON, receipt.SourcePartition,
		receipt.UpstreamQueryID, receipt.DurationMS,
	).Scan(&receipt.ID, &receipt.CreatedAt)
	if err != nil {
		return fmt.Errorf("create report agent query receipt: %w", err)
	}
	return nil
}

func (r *ReportAgentReceiptRepo) GetByOwner(ctx context.Context, ownerUserID, id string) (*model.ReportAgentQueryReceipt, error) {
	var receipt model.ReportAgentQueryReceipt
	err := r.db.GetContext(ctx, &receipt, `SELECT id, owner_user_id, source_id::text AS source_id,
		source_name, request_json, rows_json, pagination_json, source_partition,
		upstream_query_id, duration_ms, created_at
		FROM report_agent_query_receipts WHERE id=$1 AND owner_user_id=$2`, id, ownerUserID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get report agent query receipt: %w", err)
	}
	return &receipt, nil
}
