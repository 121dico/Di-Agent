package model

import (
	"encoding/json"
	"time"
)

const (
	ReportRunPending   = "pending"
	ReportRunSucceeded = "succeeded"
	ReportRunFailed    = "failed"
)

// ReportDataSource 表示一个经管理员批准的业务数据接口。
type ReportDataSource struct {
	ID           string    `json:"id" db:"id"`
	Name         string    `json:"name" db:"name"`
	Description  string    `json:"description" db:"description"`
	Endpoint     string    `json:"endpoint" db:"endpoint"`
	APIName      string    `json:"api_name" db:"api_name"`
	AppKeyEnv    string    `json:"app_key_env" db:"app_key_env"`
	AppSecretEnv string    `json:"app_secret_env" db:"app_secret_env"`
	SignatureEnv string    `json:"signature_env" db:"signature_env"`
	XDateEnv     string    `json:"x_date_env" db:"x_date_env"`
	Enabled      bool      `json:"enabled" db:"enabled"`
	CreatedBy    string    `json:"created_by" db:"created_by"`
	CreatedAt    time.Time `json:"created_at" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at" db:"updated_at"`
}

// ReportFieldContract 是数据源字段的显式白名单及其允许操作。
// 未出现在契约中或 Enabled=false 的字段均不可用于报表查询。
type ReportFieldContract struct {
	ID           string    `json:"id,omitempty" db:"id"`
	DataSourceID string    `json:"-" db:"data_source_id"`
	Name         string    `json:"name" db:"name"`
	DataType     string    `json:"data_type" db:"data_type"`
	Label        string    `json:"label,omitempty" db:"label"`
	Description  string    `json:"description,omitempty" db:"description"`
	Sensitive    bool      `json:"sensitive" db:"sensitive"`
	Enabled      bool      `json:"enabled" db:"enabled"`
	Selectable   bool      `json:"selectable" db:"selectable"`
	Filterable   bool      `json:"filterable" db:"filterable"`
	Groupable    bool      `json:"groupable" db:"groupable"`
	Aggregatable bool      `json:"aggregatable" db:"aggregatable"`
	Sortable     bool      `json:"sortable" db:"sortable"`
	CreatedAt    time.Time `json:"created_at,omitempty" db:"created_at"`
	UpdatedAt    time.Time `json:"updated_at,omitempty" db:"updated_at"`
}

// ReportDataSourceContract 是仅管理员可读写的完整数据契约。
type ReportDataSourceContract struct {
	SourceID        string                `json:"source_id" db:"source_id"`
	Name            string                `json:"name" db:"name"`
	Description     string                `json:"description" db:"description"`
	Endpoint        string                `json:"endpoint" db:"endpoint"`
	APIName         string                `json:"api_name" db:"api_name"`
	AppKeyEnv       string                `json:"app_key_env" db:"app_key_env"`
	AppSecretEnv    string                `json:"app_secret_env" db:"app_secret_env"`
	SignatureEnv    string                `json:"signature_env" db:"signature_env"`
	XDateEnv        string                `json:"x_date_env" db:"x_date_env"`
	APIExample      string                `json:"api_example" db:"api_example"`
	ResponseExample string                `json:"response_example" db:"response_example"`
	HiveTable       string                `json:"hive_table" db:"hive_table"`
	HiveDDL         string                `json:"hive_ddl" db:"hive_ddl"`
	HiveExample     string                `json:"hive_example" db:"hive_example"`
	Enabled         bool                  `json:"enabled" db:"enabled"`
	Fields          []ReportFieldContract `json:"fields"`
	UpdatedAt       time.Time             `json:"updated_at,omitempty" db:"updated_at"`
}

// ReportAgentFieldContract 是普通用户及 Agent 可见的脱敏字段能力。
type ReportAgentFieldContract struct {
	Name         string   `json:"name"`
	DataType     string   `json:"data_type"`
	Label        string   `json:"label,omitempty"`
	Description  string   `json:"description,omitempty"`
	Capabilities []string `json:"capabilities"`
}

// ReportAgentContract 只暴露调用方理解字段所需的信息，不含 API、Hive 与认证细节。
type ReportAgentContract struct {
	SourceID    string                     `json:"source_id"`
	Name        string                     `json:"name"`
	Description string                     `json:"description,omitempty"`
	Fields      []ReportAgentFieldContract `json:"fields"`
}

// ReportAgentQueryRequest is the constrained query language exposed to Agents.
// The backend translates it to the upstream data-service payload after checking
// every field against the administrator-approved contract.
type ReportAgentQueryRequest struct {
	SourceID string                   `json:"source_id"`
	Fields   []ReportAgentQueryField  `json:"fields"`
	Filters  []ReportAgentQueryFilter `json:"filters,omitempty"`
	GroupBy  []string                 `json:"group_by,omitempty"`
	OrderBy  string                   `json:"order_by,omitempty"`
	Page     int                      `json:"page,omitempty"`
	PageSize int                      `json:"page_size,omitempty"`
}

type ReportAgentQueryField struct {
	Name        string `json:"name"`
	Alias       string `json:"alias,omitempty"`
	Aggregation string `json:"aggregation,omitempty"`
}

type ReportAgentQueryFilter struct {
	Name     string `json:"name"`
	Operator string `json:"operator"`
	Value    any    `json:"value,omitempty"`
}

// ReportAgentQueryResult preserves the real upstream query provenance alongside
// the bounded row set returned to the Agent.
type ReportAgentQueryResult struct {
	SourceID        string           `json:"source_id"`
	SourceName      string           `json:"source_name"`
	Rows            []map[string]any `json:"rows"`
	Pagination      ReportPagination `json:"pagination"`
	SourcePartition string           `json:"source_partition,omitempty"`
	QueryID         string           `json:"query_id,omitempty"`
	DurationMS      int64            `json:"duration_ms"`
}

// ReportDefinition 描述一份固定、可重复运行的业务报表。
type ReportDefinition struct {
	ID                string          `json:"id" db:"id"`
	Name              string          `json:"name" db:"name"`
	Description       string          `json:"description" db:"description"`
	DataSourceID      string          `json:"data_source_id" db:"data_source_id"`
	QueryJSON         json.RawMessage `json:"query" db:"query_json"`
	VisualizationJSON json.RawMessage `json:"visualization" db:"visualization_json"`
	Enabled           bool            `json:"enabled" db:"enabled"`
	CreatedBy         string          `json:"created_by" db:"created_by"`
	CreatedAt         time.Time       `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at" db:"updated_at"`
}

// ReportRun 是一次手动或定时生成尝试及其不可变快照。
type ReportRun struct {
	ID              string          `json:"id" db:"id"`
	ReportID        string          `json:"report_id" db:"report_id"`
	Trigger         string          `json:"trigger" db:"trigger"`
	Status          string          `json:"status" db:"status"`
	RequestedBy     string          `json:"requested_by,omitempty" db:"requested_by"`
	SnapshotJSON    json.RawMessage `json:"snapshot,omitempty" db:"snapshot_json"`
	SourcePartition string          `json:"source_partition,omitempty" db:"source_partition"`
	QueryID         string          `json:"query_id,omitempty" db:"query_id"`
	DurationMS      int64           `json:"duration_ms" db:"duration_ms"`
	ErrorMessage    string          `json:"error_message,omitempty" db:"error_message"`
	StartedAt       time.Time       `json:"started_at" db:"started_at"`
	FinishedAt      *time.Time      `json:"finished_at,omitempty" db:"finished_at"`
}

type ReportQueryResult struct {
	Rows       []map[string]any
	Pagination ReportPagination
	Partition  string
	QueryID    string
	Duration   time.Duration
}

// ReportPagination 是数据服务返回的服务端分页信息。
type ReportPagination struct {
	Total     int64 `json:"total"`
	Page      int   `json:"page"`
	PageSize  int   `json:"page_size"`
	PageCount int   `json:"page_count"`
}

// ReportPageResult 是页面按需读取的大表明细，不写入运行历史。
type ReportPageResult struct {
	Rows            []map[string]any `json:"rows"`
	Pagination      ReportPagination `json:"pagination"`
	SourcePartition string           `json:"source_partition,omitempty"`
	QueryID         string           `json:"query_id,omitempty"`
	DurationMS      int64            `json:"duration_ms"`
}

type ReportAnalyticsSummary struct {
	AveragePriceSensitivityScore float64 `json:"average_price_sensitivity_score"`
	TotalUserCount               int64   `json:"total_user_count"`
	TotalOrderCount              int64   `json:"total_order_count"`
	CalculatedUserCount          int64   `json:"calculated_user_count"`
	CalculatedUserShare          float64 `json:"calculated_user_share"`
	HighSensitivityShare         float64 `json:"high_sensitivity_share"`
	MediumSensitivityShare       float64 `json:"medium_sensitivity_share"`
	LowSensitivityShare          float64 `json:"low_sensitivity_share"`
	BaselineCalculatedUserCount  int64   `json:"baseline_calculated_user_count"`
	LatestDailyNetUserGrowth     int64   `json:"latest_daily_net_user_growth"`
	CumulativeNetUserGrowth      int64   `json:"cumulative_net_user_growth"`
	LatestUserGrowthRate         float64 `json:"latest_user_growth_rate"`
	AverageDailyNetUserGrowth    float64 `json:"average_daily_net_user_growth"`
}

type ReportAnalyticsTrendPoint struct {
	NullableScores               map[string]*float64 `json:"nullable_scores,omitempty"`
	Date                         string              `json:"dt"`
	AveragePriceSensitivityScore float64             `json:"average_price_sensitivity_score"`
	AverageD1PriceScore          float64             `json:"average_d1_price_score"`
	AverageD2CouponScore         float64             `json:"average_d2_coupon_score"`
	AverageD3TimeScore           float64             `json:"average_d3_time_score"`
	TotalOrderCount              int64               `json:"total_order_count"`
	CalculatedUserCount          int64               `json:"calculated_user_count"`
	DailyNetUserGrowth           int64               `json:"daily_net_user_growth"`
	DailyGrowthAvailable         *bool               `json:"daily_growth_available,omitempty"`
	DailyUserGrowthRate          float64             `json:"daily_user_growth_rate"`
	CumulativeNetUserGrowth      int64               `json:"cumulative_net_user_growth"`
}

type ReportAnalyticsDistribution struct {
	Level     string `json:"level"`
	UserCount int64  `json:"user_count"`
}

type ReportAnalyticsCohort struct {
	UserCount    int64                         `json:"user_count"`
	Share        float64                       `json:"share"`
	Distribution []ReportAnalyticsDistribution `json:"distribution"`
}

// ReportAnalyticsResult 是固定价敏报表按时间范围聚合后的指标与图表数据。
type ReportAnalyticsResult struct {
	OrderCohort    *ReportAnalyticsCohort        `json:"order_cohort,omitempty"`
	Profile        string                        `json:"profile,omitempty"`
	DataDate       string                        `json:"data_date,omitempty"`
	FetchedAt      string                        `json:"fetched_at,omitempty"`
	QueryIDs       []string                      `json:"query_ids,omitempty"`
	MissingDates   []string                      `json:"missing_dates,omitempty"`
	AssignedByType map[string]int64              `json:"assigned_by_type,omitempty"`
	Range          string                        `json:"range"`
	StartDate      string                        `json:"start_date"`
	EndDate        string                        `json:"end_date"`
	Cached         bool                          `json:"cached"`
	Summary        ReportAnalyticsSummary        `json:"summary"`
	Trend          []ReportAnalyticsTrendPoint   `json:"trend"`
	Distribution   []ReportAnalyticsDistribution `json:"distribution"`
	DurationMS     int64                         `json:"duration_ms"`
}

// ReportDailyAnalytics 是每日 10 点逐日积累的价敏聚合快照。
type ReportDailyAnalytics struct {
	ReportID                     string          `db:"report_id"`
	Date                         string          `db:"stat_date"`
	AveragePriceSensitivityScore float64         `db:"avg_price_sensitivity_score"`
	AverageD1PriceScore          float64         `db:"avg_d1_price_score"`
	AverageD2CouponScore         float64         `db:"avg_d2_coupon_score"`
	AverageD3TimeScore           float64         `db:"avg_d3_time_score"`
	TotalUserCount               int64           `db:"total_user_count"`
	TotalOrderCount              int64           `db:"total_order_count"`
	CalculatedUserCount          int64           `db:"calculated_user_count"`
	DistributionJSON             json.RawMessage `db:"distribution_json"`
}
