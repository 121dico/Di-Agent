package model

import (
	"encoding/json"
	"time"
)

// HiveConnectionStatus 是面板可展示的连接状态，不包含认证秘密。
type HiveConnectionStatus struct {
	Kind        string `json:"kind"`
	Name        string `json:"name"`
	Account     string `json:"account"`
	Status      string `json:"status"`
	Detail      string `json:"detail"`
	SourceCount int    `json:"source_count,omitempty"`
}

type DataSessionIdentity struct {
	Provider string `json:"provider"`
	Account  string `json:"account"`
	UserID   string `json:"user_id"`
}

type HiveTable struct {
	Name             string `json:"name"`
	Description      string `json:"description"`
	Permission       string `json:"permission"`
	PermissionDetail string `json:"permission_detail"`
	QueryEnabled     bool   `json:"query_enabled,omitempty"`
}

type HiveField struct {
	Name             string `json:"name"`
	DataType         string `json:"data_type"`
	Description      string `json:"description"`
	Partition        bool   `json:"partition"`
	Access           string `json:"access"`
	PermissionDetail string `json:"permission_detail"`
}

type HiveFieldSnapshot struct {
	TableName      string      `json:"table_name"`
	State          string      `json:"state"`
	TotalFields    int         `json:"total_fields"`
	CheckedFields  int         `json:"checked_fields"`
	ReadableFields int         `json:"readable_fields"`
	DeniedFields   int         `json:"denied_fields"`
	UnknownFields  int         `json:"unknown_fields"`
	Fields         []HiveField `json:"fields"`
	Error          string      `json:"error,omitempty"`
}

type HiveSavedTable struct {
	Name        string `db:"table_name"`
	DTQueryable bool   `db:"dt_queryable"`
}

// HiveCatalogSnapshot 是后台逐步扫描的进度快照；可见不等于可读取。
type HiveCatalogSnapshot struct {
	State            string      `json:"state"`
	DatabaseCount    int         `json:"database_count"`
	ScannedDatabases int         `json:"scanned_databases"`
	DiscoveredTables int         `json:"discovered_tables"`
	CheckedTables    int         `json:"checked_tables"`
	ReadableTables   int         `json:"readable_tables"`
	FailedDatabases  int         `json:"failed_databases"`
	Tables           []HiveTable `json:"tables"`
	HasMore          bool        `json:"has_more"`
	Error            string      `json:"error,omitempty"`
	Notice           string      `json:"notice,omitempty"`
}

type HiveLoginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type HiveAddTableRequest struct {
	TableName string `json:"table_name" binding:"required"`
}

type APIConnectionStatus struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Account string `json:"account"`
	Status  string `json:"status"`
	Detail  string `json:"detail"`
}

type HiveQueryReceipt struct {
	ID          string          `json:"id" db:"id"`
	OwnerUserID string          `json:"-" db:"owner_user_id"`
	TableName   string          `json:"table_name" db:"table_name"`
	SQL         string          `json:"sql" db:"sql_text"`
	RowsJSON    json.RawMessage `json:"rows" db:"rows_json"`
	RowCount    int             `json:"row_count" db:"row_count"`
	DurationMS  int64           `json:"duration_ms" db:"duration_ms"`
	CreatedAt   time.Time       `json:"created_at" db:"created_at"`
}

type HiveQueryRequest struct {
	TableName string `json:"table_name" binding:"required"`
	SQL       string `json:"sql" binding:"required"`
}

// HiveProbeRequest intentionally accepts no arbitrary SQL or column names.
type HiveProbeRequest struct {
	TableName string `json:"table_name" binding:"required"`
	DT        string `json:"dt" binding:"required"`
}

type HiveProbeResult struct {
	TableName string `json:"table_name"`
	DT        string `json:"dt"`
	Readable  bool   `json:"readable"`
	RowFound  bool   `json:"row_found"`
	Scope     string `json:"scope"`
}
