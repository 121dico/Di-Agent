package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/jmoiron/sqlx"
)

type HiveQueryRepo struct{ db *sqlx.DB }

func NewHiveQueryRepo(db *sqlx.DB) *HiveQueryRepo { return &HiveQueryRepo{db: db} }

func (r *HiveQueryRepo) Create(ctx context.Context, row *model.HiveQueryReceipt) error {
	err := r.db.QueryRowxContext(ctx, `INSERT INTO hive_query_receipts
		(owner_user_id, table_name, sql_text, rows_json, row_count, duration_ms)
		VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, created_at`,
		row.OwnerUserID, row.TableName, row.SQL, row.RowsJSON, row.RowCount, row.DurationMS,
	).Scan(&row.ID, &row.CreatedAt)
	if err != nil {
		return fmt.Errorf("save hive query receipt: %w", err)
	}
	return nil
}

func (r *HiveQueryRepo) List(ctx context.Context, ownerID string) ([]model.HiveQueryReceipt, error) {
	var rows []model.HiveQueryReceipt
	err := r.db.SelectContext(ctx, &rows, `SELECT id, owner_user_id, table_name, sql_text,
		'[]'::jsonb AS rows_json, row_count, duration_ms, created_at
		FROM hive_query_receipts WHERE owner_user_id=$1 ORDER BY created_at DESC LIMIT 50`, ownerID)
	if err != nil {
		return nil, fmt.Errorf("list hive query receipts: %w", err)
	}
	return rows, nil
}

func (r *HiveQueryRepo) Get(ctx context.Context, ownerID, id string) (*model.HiveQueryReceipt, error) {
	var row model.HiveQueryReceipt
	err := r.db.GetContext(ctx, &row, `SELECT id, owner_user_id, table_name, sql_text,
		rows_json, row_count, duration_ms, created_at
		FROM hive_query_receipts WHERE id=$1 AND owner_user_id=$2`, id, ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get hive query receipt: %w", err)
	}
	return &row, nil
}

func (r *HiveQueryRepo) ListAddedTables(ctx context.Context, ownerID, account string) ([]model.HiveSavedTable, error) {
	var rows []model.HiveSavedTable
	err := r.db.SelectContext(ctx, &rows, `SELECT table_name, dt_queryable FROM hive_user_tables
		WHERE owner_user_id=$1 AND hadoop_account=$2 ORDER BY added_at DESC LIMIT 50`, ownerID, account)
	if err != nil {
		return nil, fmt.Errorf("list added hive tables: %w", err)
	}
	return rows, nil
}

func (r *HiveQueryRepo) AddTable(ctx context.Context, ownerID, account, name string, dtQueryable bool) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO hive_user_tables (owner_user_id, hadoop_account, table_name, dt_queryable)
		VALUES ($1,$2,$3,$4) ON CONFLICT (owner_user_id, hadoop_account, table_name)
		DO UPDATE SET dt_queryable=EXCLUDED.dt_queryable, added_at=NOW()`, ownerID, account, name, dtQueryable)
	if err != nil {
		return fmt.Errorf("add hive table: %w", err)
	}
	return nil
}
