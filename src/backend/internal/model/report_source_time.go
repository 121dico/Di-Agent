package model

import "time"

// ReportSourceTimeRange 只记录真实端点，不代表中间每日连续。
type ReportSourceTimeRange struct {
	Field     string  `json:"field"`
	Start     *string `json:"start"`
	End       *string `json:"end"`
	Empty     bool    `json:"empty"`
	Partition string  `json:"partition,omitempty"`
}
type ReportSourceTimeCoverage struct {
	SourceID    string                 `json:"source_id"`
	Status      string                 `json:"status"`
	CheckedAt   *time.Time             `json:"checked_at,omitempty"`
	AttemptedAt *time.Time             `json:"attempted_at,omitempty"`
	Error       string                 `json:"error,omitempty"`
	Partition   *ReportSourceTimeRange `json:"partition,omitempty"`
	Business    *ReportSourceTimeRange `json:"business,omitempty"`
	Continuous  bool                   `json:"continuous"`
	Fingerprint string                 `json:"fingerprint"`
}
