package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/jmoiron/sqlx"
)

type PersonalReportRepo struct{ db *sqlx.DB }

func NewPersonalReportRepo(db *sqlx.DB) *PersonalReportRepo {
	return &PersonalReportRepo{db: db}
}

const personalReportColumns = `id, owner_user_id,
	conversation_id::text AS conversation_id, message_id::text AS message_id,
	data_source_id::text AS data_source_id, title, description, status,
	style_preset, style_prompt, query_json, document_json, provenance_json,
	revision, created_at, updated_at`

func (r *PersonalReportRepo) ListByOwner(ctx context.Context, ownerUserID string) ([]model.PersonalReport, error) {
	rows := make([]model.PersonalReport, 0)
	err := r.db.SelectContext(ctx, &rows, `SELECT `+personalReportColumns+`
		FROM personal_reports WHERE owner_user_id=$1 ORDER BY updated_at DESC`, ownerUserID)
	if err != nil {
		return nil, fmt.Errorf("list personal reports: %w", err)
	}
	return rows, nil
}

func (r *PersonalReportRepo) GetByID(ctx context.Context, id string) (*model.PersonalReport, error) {
	var row model.PersonalReport
	err := r.db.GetContext(ctx, &row, `SELECT `+personalReportColumns+` FROM personal_reports WHERE id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get personal report: %w", err)
	}
	return &row, nil
}

func (r *PersonalReportRepo) Create(ctx context.Context, report *model.PersonalReport) error {
	err := r.db.QueryRowxContext(ctx, `INSERT INTO personal_reports
		(owner_user_id, conversation_id, message_id, data_source_id, title, description,
		 status, style_preset, style_prompt, query_json, document_json, provenance_json)
		VALUES ($1,NULLIF($2,'')::uuid,NULLIF($3,'')::uuid,NULLIF($4,'')::uuid,$5,$6,$7,$8,$9,$10,$11,$12)
		RETURNING id, revision, created_at, updated_at`,
		report.OwnerUserID, stringPtrValue(report.ConversationID), stringPtrValue(report.MessageID),
		stringPtrValue(report.DataSourceID), report.Title, report.Description, report.Status,
		report.StylePreset, report.StylePrompt, report.QueryJSON, report.DocumentJSON, report.ProvenanceJSON,
	).Scan(&report.ID, &report.Revision, &report.CreatedAt, &report.UpdatedAt)
	if err != nil {
		return fmt.Errorf("create personal report: %w", err)
	}
	return nil
}

func (r *PersonalReportRepo) Update(ctx context.Context, report *model.PersonalReport) error {
	err := r.db.QueryRowxContext(ctx, `UPDATE personal_reports SET
		conversation_id=NULLIF($3,'')::uuid, message_id=NULLIF($4,'')::uuid,
		data_source_id=NULLIF($5,'')::uuid, title=$6, description=$7, status=$8,
		style_preset=$9, style_prompt=$10, query_json=$11, document_json=$12,
		provenance_json=$13, revision=revision+1, updated_at=NOW()
		WHERE id=$1 AND owner_user_id=$2
		RETURNING revision, updated_at`, report.ID, report.OwnerUserID,
		stringPtrValue(report.ConversationID), stringPtrValue(report.MessageID), stringPtrValue(report.DataSourceID),
		report.Title, report.Description, report.Status, report.StylePreset, report.StylePrompt,
		report.QueryJSON, report.DocumentJSON, report.ProvenanceJSON,
	).Scan(&report.Revision, &report.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return sql.ErrNoRows
	}
	if err != nil {
		return fmt.Errorf("update personal report: %w", err)
	}
	return nil
}

func (r *PersonalReportRepo) Delete(ctx context.Context, id, ownerUserID string) (bool, error) {
	result, err := r.db.ExecContext(ctx, `DELETE FROM personal_reports WHERE id=$1 AND owner_user_id=$2`, id, ownerUserID)
	if err != nil {
		return false, fmt.Errorf("delete personal report: %w", err)
	}
	count, err := result.RowsAffected()
	if err != nil {
		return false, fmt.Errorf("read deleted personal report count: %w", err)
	}
	return count > 0, nil
}

func stringPtrValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
