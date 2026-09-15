package service

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// querySourceDateGroups 没有聚合权限时只读取去重日期组；严格验证分页完整性。
func (s *ReportService) querySourceDateGroups(ctx context.Context, source model.ReportDataSource, fields map[string]model.ReportFieldContract, field, partition string) (*model.ReportSourceTimeRange, error) {
	result := &model.ReportSourceTimeRange{Field: field, Partition: partition, Empty: true}
	seen := map[string]bool{}
	total := int64(-1)
	for page := 1; page <= 10; page++ {
		query := map[string]any{"apiName": source.APIName, "fieldList": []any{map[string]any{"name": field}}, "groupList": []any{field}, "orderBy": field, "needPagination": true, "pageSize": 1000, "page": page, "useMockData": false, "queryTypeEnum": "SYNC"}
		if partition != "" {
			query["conditionList"] = []any{map[string]any{"name": "dt", "operatorEnum": "EQ", "value": partition}}
		}
		if err := validateQueryContractLevel(query, fields); err != nil {
			return nil, &sourceTimeQueryError{kind: "contract", err: err}
		}
		if s.runner == nil || s.runner.connector == nil {
			return nil, errors.New("source connector unavailable")
		}
		raw, err := json.Marshal(query)
		if err != nil {
			return nil, err
		}
		r, err := s.runner.connector.Query(ctx, source, raw)
		if err != nil {
			return nil, &sourceTimeQueryError{kind: "upstream", err: err}
		}
		n := int64(r.Pagination.Total)
		if n < 0 || n > 10000 || (total >= 0 && n != total) || r.Pagination.Page != page || r.Pagination.PageSize != 1000 {
			return nil, errors.New("invalid date group pagination")
		}
		total = n
		expectedPages := (int(total) + 999) / 1000
		if expectedPages < 1 {
			expectedPages = 1
		}
		if r.Pagination.PageCount != expectedPages && !(total == 0 && r.Pagination.PageCount == 0) {
			return nil, errors.New("invalid date group page count")
		}
		expectedRows := 1000
		if remaining := int(total) - (page-1)*1000; remaining < expectedRows {
			expectedRows = remaining
		}
		if len(r.Rows) != expectedRows {
			return nil, errors.New("incomplete date groups")
		}
		for _, row := range r.Rows {
			date, err := sourceTimeDate(row, field)
			if err != nil {
				return nil, err
			}
			if date == nil {
				return nil, errors.New("null date group")
			}
			if seen[*date] {
				return nil, errors.New("duplicate date group")
			}
			seen[*date] = true
			if result.Start == nil || *date < *result.Start {
				result.Start = date
			}
			if result.End == nil || *date > *result.End {
				result.End = date
			}
			result.Empty = false
		}
		if page == expectedPages {
			return result, nil
		}
	}
	return nil, errors.New("date groups exceed limit")
}
