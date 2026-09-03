package repository

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/jmoiron/sqlx"
)

type ReportRepo struct{ db *sqlx.DB }

func NewReportRepo(db *sqlx.DB) *ReportRepo { return &ReportRepo{db: db} }

const reportDataSourceBaseColumns = `id, name, description, endpoint, api_name, app_key_env,
	app_secret_env, signature_env, x_date_env, enabled, created_by, created_at, updated_at`

func (r *ReportRepo) ListReportDataSources(ctx context.Context) ([]model.ReportDataSource, error) {
	var rows []model.ReportDataSource
	err := r.db.SelectContext(ctx, &rows, `SELECT `+reportDataSourceBaseColumns+` FROM report_data_sources ORDER BY created_at DESC`)
	return rows, wrapReportRepoErr("list report data sources", err)
}

func (r *ReportRepo) CreateReportDataSource(ctx context.Context, source *model.ReportDataSource) error {
	err := r.db.QueryRowxContext(ctx, `INSERT INTO report_data_sources
		(name, description, endpoint, api_name, app_key_env, app_secret_env, signature_env, x_date_env, enabled, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, created_at, updated_at`,
		source.Name, source.Description, source.Endpoint, source.APIName, source.AppKeyEnv, source.AppSecretEnv, source.SignatureEnv, source.XDateEnv, source.Enabled, source.CreatedBy,
	).Scan(&source.ID, &source.CreatedAt, &source.UpdatedAt)
	return wrapReportRepoErr("create report data source", err)
}

func (r *ReportRepo) GetReportDataSource(ctx context.Context, id string) (*model.ReportDataSource, error) {
	var row model.ReportDataSource
	err := r.db.GetContext(ctx, &row, `SELECT `+reportDataSourceBaseColumns+` FROM report_data_sources WHERE id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get report data source: %w", err)
	}
	return &row, nil
}

func (r *ReportRepo) GetReportDataSourceContract(ctx context.Context, sourceID string) (*model.ReportDataSourceContract, error) {
	var contract model.ReportDataSourceContract
	err := r.db.GetContext(ctx, &contract, `SELECT id AS source_id, name, description, endpoint, api_name,
		app_key_env, app_secret_env, signature_env, x_date_env, api_example, response_example, hive_table, hive_ddl, hive_example, enabled, updated_at
		FROM report_data_sources WHERE id=$1`, sourceID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get report data source contract: %w", err)
	}
	if err := r.db.SelectContext(ctx, &contract.Fields, `SELECT id, data_source_id, name, data_type, label,
		description, sensitive, enabled, selectable, filterable, groupable, aggregatable, sortable,
		created_at, updated_at FROM report_data_source_fields WHERE data_source_id=$1 ORDER BY name`, sourceID); err != nil {
		return nil, fmt.Errorf("list report data source fields: %w", err)
	}
	return &contract, nil
}

func (r *ReportRepo) ReplaceReportDataSourceContract(ctx context.Context, contract *model.ReportDataSourceContract) error {
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin replace report data source contract: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	err = tx.QueryRowxContext(ctx, `UPDATE report_data_sources SET
		name=$2, description=$3, endpoint=$4, api_name=$5, app_key_env=$6, app_secret_env=$7, signature_env=$8, x_date_env=$9,
		api_example=$10, response_example=$11, hive_table=$12, hive_ddl=$13, hive_example=$14, updated_at=NOW()
		WHERE id=$1 RETURNING updated_at`, contract.SourceID, contract.Name, contract.Description,
		contract.Endpoint, contract.APIName, contract.AppKeyEnv, contract.AppSecretEnv, contract.SignatureEnv, contract.XDateEnv,
		contract.APIExample, contract.ResponseExample, contract.HiveTable, contract.HiveDDL, contract.HiveExample).Scan(&contract.UpdatedAt)
	if err != nil {
		return fmt.Errorf("update report data source contract: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM report_data_source_fields WHERE data_source_id=$1`, contract.SourceID); err != nil {
		return fmt.Errorf("replace report data source fields: %w", err)
	}
	for i := range contract.Fields {
		field := &contract.Fields[i]
		err := tx.QueryRowxContext(ctx, `INSERT INTO report_data_source_fields
			(data_source_id, name, data_type, label, description, sensitive, enabled,
			 selectable, filterable, groupable, aggregatable, sortable)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
			RETURNING id, created_at, updated_at`, contract.SourceID, field.Name, field.DataType,
			field.Label, field.Description, field.Sensitive, field.Enabled, field.Selectable,
			field.Filterable, field.Groupable, field.Aggregatable, field.Sortable,
		).Scan(&field.ID, &field.CreatedAt, &field.UpdatedAt)
		if err != nil {
			return fmt.Errorf("insert report data source field %s: %w", field.Name, err)
		}
		field.DataSourceID = contract.SourceID
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit report data source contract: %w", err)
	}
	return nil
}

func (r *ReportRepo) ListReportDataSourceContracts(ctx context.Context) ([]model.ReportDataSourceContract, error) {
	var contracts []model.ReportDataSourceContract
	err := r.db.SelectContext(ctx, &contracts, `SELECT id AS source_id, name, description, endpoint, api_name,
		app_key_env, app_secret_env, signature_env, x_date_env, api_example, response_example, hive_table, hive_ddl, hive_example, enabled, updated_at
		FROM report_data_sources WHERE enabled=TRUE ORDER BY name`)
	if err != nil {
		return nil, wrapReportRepoErr("list report data source contracts", err)
	}
	if len(contracts) == 0 {
		return contracts, nil
	}
	var fields []model.ReportFieldContract
	if err := r.db.SelectContext(ctx, &fields, `SELECT id, data_source_id, name, data_type, label,
		description, sensitive, enabled, selectable, filterable, groupable, aggregatable, sortable,
		created_at, updated_at FROM report_data_source_fields ORDER BY name`); err != nil {
		return nil, fmt.Errorf("list report data source contract fields: %w", err)
	}
	bySource := make(map[string][]model.ReportFieldContract, len(contracts))
	for _, field := range fields {
		bySource[field.DataSourceID] = append(bySource[field.DataSourceID], field)
	}
	for i := range contracts {
		contracts[i].Fields = bySource[contracts[i].SourceID]
	}
	return contracts, nil
}

func (r *ReportRepo) ListReportDefinitions(ctx context.Context) ([]model.ReportDefinition, error) {
	var rows []model.ReportDefinition
	err := r.db.SelectContext(ctx, &rows, `SELECT * FROM report_definitions ORDER BY created_at DESC`)
	return rows, wrapReportRepoErr("list report definitions", err)
}

func (r *ReportRepo) ListEnabledReportDefinitions(ctx context.Context) ([]model.ReportDefinition, error) {
	var rows []model.ReportDefinition
	err := r.db.SelectContext(ctx, &rows, `SELECT * FROM report_definitions WHERE enabled=TRUE ORDER BY created_at`)
	return rows, wrapReportRepoErr("list enabled report definitions", err)
}

func (r *ReportRepo) CreateReportDefinition(ctx context.Context, report *model.ReportDefinition) error {
	err := r.db.QueryRowxContext(ctx, `INSERT INTO report_definitions
		(name, description, data_source_id, query_json, visualization_json, enabled, created_by)
		VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at, updated_at`,
		report.Name, report.Description, report.DataSourceID, report.QueryJSON, report.VisualizationJSON, report.Enabled, report.CreatedBy,
	).Scan(&report.ID, &report.CreatedAt, &report.UpdatedAt)
	return wrapReportRepoErr("create report definition", err)
}

func (r *ReportRepo) UpdateReportDefinition(ctx context.Context, report *model.ReportDefinition) error {
	err := r.db.QueryRowxContext(ctx, `UPDATE report_definitions SET
		name=$2, description=$3, data_source_id=$4, query_json=$5, visualization_json=$6,
		enabled=$7, updated_at=NOW() WHERE id=$1 RETURNING updated_at`,
		report.ID, report.Name, report.Description, report.DataSourceID, report.QueryJSON,
		report.VisualizationJSON, report.Enabled,
	).Scan(&report.UpdatedAt)
	return wrapReportRepoErr("update report definition", err)
}

func (r *ReportRepo) GetReportDefinition(ctx context.Context, id string) (*model.ReportDefinition, error) {
	var row model.ReportDefinition
	err := r.db.GetContext(ctx, &row, `SELECT * FROM report_definitions WHERE id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get report definition: %w", err)
	}
	return &row, nil
}

func (r *ReportRepo) StartReportRun(ctx context.Context, run *model.ReportRun) error {
	_, err := r.db.ExecContext(ctx, `INSERT INTO report_runs
		(id, report_id, trigger, status, requested_by, started_at)
		VALUES ($1,$2,$3,$4,NULLIF($5,'')::uuid,$6)`, run.ID, run.ReportID, run.Trigger, run.Status, run.RequestedBy, run.StartedAt)
	return wrapReportRepoErr("start report run", err)
}

func (r *ReportRepo) CompleteReportRun(ctx context.Context, run *model.ReportRun) error {
	_, err := r.db.ExecContext(ctx, `UPDATE report_runs SET status=$2, snapshot_json=$3, source_partition=$4,
		query_id=$5, duration_ms=$6, finished_at=$7 WHERE id=$1`, run.ID, run.Status, run.SnapshotJSON,
		run.SourcePartition, run.QueryID, run.DurationMS, run.FinishedAt)
	return wrapReportRepoErr("complete report run", err)
}

func (r *ReportRepo) FailReportRun(ctx context.Context, run *model.ReportRun) error {
	_, err := r.db.ExecContext(ctx, `UPDATE report_runs SET status=$2, error_message=$3, finished_at=$4 WHERE id=$1`,
		run.ID, run.Status, run.ErrorMessage, run.FinishedAt)
	return wrapReportRepoErr("fail report run", err)
}

func (r *ReportRepo) ListReportRuns(ctx context.Context, reportID string, limit int) ([]model.ReportRun, error) {
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	var rows []model.ReportRun
	err := r.db.SelectContext(ctx, &rows, `SELECT id, report_id, trigger, status,
		COALESCE(requested_by::text, '') AS requested_by, COALESCE(snapshot_json, '[]'::jsonb) AS snapshot_json, source_partition, query_id,
		duration_ms, error_message, started_at, finished_at
		FROM report_runs WHERE report_id=$1 ORDER BY started_at DESC LIMIT $2`, reportID, limit)
	return rows, wrapReportRepoErr("list report runs", err)
}

func (r *ReportRepo) GetReportRun(ctx context.Context, id string) (*model.ReportRun, error) {
	var row model.ReportRun
	err := r.db.GetContext(ctx, &row, `SELECT id, report_id, trigger, status,
		COALESCE(requested_by::text, '') AS requested_by, COALESCE(snapshot_json, '[]'::jsonb) AS snapshot_json, source_partition, query_id,
		duration_ms, error_message, started_at, finished_at FROM report_runs WHERE id=$1`, id)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("get report run: %w", err)
	}
	return &row, nil
}

func (r *ReportRepo) UpsertReportDailyAnalytics(ctx context.Context, row *model.ReportDailyAnalytics) error {
	if !json.Valid(row.DistributionJSON) {
		row.DistributionJSON = json.RawMessage(`[]`)
	}
	_, err := r.db.ExecContext(ctx, `INSERT INTO report_daily_analytics
		(report_id, stat_date, avg_price_sensitivity_score, avg_d1_price_score, avg_d2_coupon_score,
		 avg_d3_time_score, total_user_count, total_order_count, calculated_user_count, distribution_json)
		VALUES ($1,$2::date,$3,$4,$5,$6,$7,$8,$9,$10)
		ON CONFLICT (report_id, stat_date) DO UPDATE SET
		 avg_price_sensitivity_score=EXCLUDED.avg_price_sensitivity_score,
		 avg_d1_price_score=EXCLUDED.avg_d1_price_score, avg_d2_coupon_score=EXCLUDED.avg_d2_coupon_score,
		 avg_d3_time_score=EXCLUDED.avg_d3_time_score, total_user_count=EXCLUDED.total_user_count, total_order_count=EXCLUDED.total_order_count,
		 calculated_user_count=EXCLUDED.calculated_user_count, distribution_json=EXCLUDED.distribution_json,
		 updated_at=NOW()`, row.ReportID, row.Date, row.AveragePriceSensitivityScore, row.AverageD1PriceScore,
		row.AverageD2CouponScore, row.AverageD3TimeScore, row.TotalUserCount, row.TotalOrderCount, row.CalculatedUserCount, row.DistributionJSON)
	return wrapReportRepoErr("upsert report daily analytics", err)
}

func (r *ReportRepo) ListReportDailyAnalytics(ctx context.Context, reportID, startDate, endDate string) ([]model.ReportDailyAnalytics, error) {
	var rows []model.ReportDailyAnalytics
	err := r.db.SelectContext(ctx, &rows, `SELECT report_id, TO_CHAR(stat_date, 'YYYY-MM-DD') AS stat_date,
		avg_price_sensitivity_score, avg_d1_price_score, avg_d2_coupon_score, avg_d3_time_score,
		total_user_count, total_order_count, calculated_user_count, distribution_json
		FROM report_daily_analytics WHERE report_id=$1 AND stat_date BETWEEN $2::date AND $3::date ORDER BY stat_date`, reportID, startDate, endDate)
	return rows, wrapReportRepoErr("list report daily analytics", err)
}

func wrapReportRepoErr(op string, err error) error {
	if err != nil {
		return fmt.Errorf("%s: %w", op, err)
	}
	return nil
}
