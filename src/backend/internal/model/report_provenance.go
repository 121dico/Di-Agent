package model

import (
	"encoding/json"
	"time"
)

type ReportChartBinding struct {
	ChartKey     string            `json:"chart_key"`
	Title        string            `json:"title"`
	QueryKeys    []string          `json:"query_keys"`
	Formula      string            `json:"formula"`
	FieldMapping map[string]string `json:"field_mapping"`
}

// 聚合执行记录为不可变快照，不存储用户明细。
type ReportQueryExecution struct {
	ID             string               `json:"id"`
	ReportID       string               `json:"report_id"`
	SourceID       string               `json:"source_id"`
	APIName        string               `json:"api_name"`
	SourceName     string               `json:"source_name"`
	QueryKey       string               `json:"query_key"`
	RequestJSON    json.RawMessage      `json:"request_json"`
	SQL            string               `json:"sql"`
	QueryID        string               `json:"query_id"`
	Status         string               `json:"status"`
	ErrorMessage   string               `json:"error_message"`
	Rows           []map[string]any     `json:"rows"`
	CreatedAt      time.Time            `json:"created_at"`
	DurationMS     int64                `json:"duration_ms"`
	StartDate      string               `json:"start_date"`
	EndDate        string               `json:"end_date"`
	Cities         []string             `json:"cities"`
	BindingVersion string               `json:"binding_version"`
	Bindings       []ReportChartBinding `json:"bindings"`
	ReplayOf       string               `json:"replay_of,omitempty"`
}

type ReportProvenance struct {
	Bindings   []ReportChartBinding   `json:"bindings"`
	Executions []ReportQueryExecution `json:"executions"`
	Available  bool                   `json:"available"`
	Message    string                 `json:"message"`
}

type ReportProvenanceReplay struct {
	Execution  *ReportQueryExecution `json:"execution"`
	ReplayOnly bool                  `json:"replay_only"`
	Message    string                `json:"message"`
}
