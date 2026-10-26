package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// queryPreparedAgentData gives the Agent the same prepared V1.2 snapshot used
// by the public report. It never falls back to a fresh full-table distinct scan.
func (s *ReportService) queryPreparedAgentData(ctx context.Context, userID string, request model.ReportAgentQueryRequest) (*model.ReportAgentQueryResult, error) {
	if request.PreparedView != "v12_dashboard" || request.SourceID == "" || strings.TrimSpace(userID) == "" || s.agentReceipts == nil || s.runner == nil ||
		len(request.Fields) != 1 || request.Fields[0].Name != "dt" || request.Fields[0].Alias != "" || request.Fields[0].Aggregation != "" ||
		len(request.Filters) != 0 || len(request.GroupBy) != 0 || request.OrderBy != "" || request.Page > 1 || request.PageSize > 1 {
		return nil, fmt.Errorf("%w: 预计算报表查询参数无效", ErrReportInvalid)
	}
	source, err := s.store.GetReportDataSource(ctx, request.SourceID)
	if err != nil {
		return nil, err
	}
	contract, err := s.store.GetReportDataSourceContract(ctx, request.SourceID)
	if err != nil {
		return nil, err
	}
	if source == nil || contract == nil || !source.Enabled || !contract.Enabled || source.APIName != "price_sensitive_v1_2" {
		return nil, ErrReportSourceMissing
	}
	reports, err := s.store.ListEnabledReportDefinitions(ctx)
	if err != nil {
		return nil, err
	}
	reportID := ""
	for _, report := range reports {
		if report.DataSourceID == source.ID && isV12Report(&report) {
			reportID = report.ID
			break
		}
	}
	if reportID == "" {
		return nil, fmt.Errorf("%w: 此源没有已配置的 V1.2 报表", ErrReportInvalid)
	}
	analytics, err := s.runner.QueryAnalytics(ctx, reportID, "saved", "", ReportAnalyticsOptions{})
	if err != nil {
		return nil, err
	}
	if analytics == nil || !analytics.Prepared || analytics.DataDate == "" || len(analytics.Trend) == 0 {
		return nil, fmt.Errorf("%w: V1.2 预计算快照不完整", ErrReportInvalid)
	}
	fullRows := []map[string]any{{"analytics": analytics}}
	rowsJSON, err := json.Marshal(fullRows)
	if err != nil {
		return nil, err
	}
	pagination := model.ReportPagination{Total: 1, Page: 1, PageSize: 1, PageCount: 1}
	paginationJSON, err := json.Marshal(pagination)
	if err != nil {
		return nil, err
	}
	requestJSON, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	receipt := &model.ReportAgentQueryReceipt{
		OwnerUserID: userID, SourceID: source.ID, SourceName: contract.Name,
		RequestJSON: requestJSON, RowsJSON: rowsJSON, PaginationJSON: paginationJSON,
		SourcePartition: analytics.DataDate, UpstreamQueryID: "prepared:" + reportID + ":" + analytics.DataDate,
		DurationMS: analytics.DurationMS,
	}
	if err := s.agentReceipts.Create(ctx, receipt); err != nil {
		return nil, err
	}
	return &model.ReportAgentQueryResult{
		SourceID: source.ID, SourceName: contract.Name,
		Rows: []map[string]any{{"data_date": analytics.DataDate, "summary": analytics.Summary, "distribution": analytics.Distribution,
			"trend_points": len(analytics.Trend), "prepared": true}},
		Pagination: pagination, SourcePartition: analytics.DataDate, QueryID: receipt.ID, DurationMS: analytics.DurationMS,
	}, nil
}
