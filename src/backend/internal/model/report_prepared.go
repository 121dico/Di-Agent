package model

// ReportPreparedDay 仅存城市级聚合，不包含 DUID 或订单明细。
type ReportPreparedDay struct {
	Date         string                      `json:"date"`
	FetchedAt    string                      `json:"fetched_at"`
	ExecutionIDs []string                    `json:"execution_ids"`
	Totals       []map[string]any            `json:"totals"`
	Assigned     []map[string]any            `json:"assigned"`
	Orders       []map[string]any            `json:"orders"`
	Groups       map[string][]map[string]any `json:"groups"`
}
