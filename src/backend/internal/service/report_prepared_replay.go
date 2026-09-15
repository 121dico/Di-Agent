package service

import (
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"strings"
)

func trustedPreparedReplay(report *model.ReportDefinition, saved *model.ReportQueryExecution, decoded map[string]any) (map[string]any, error) {
	if saved.StartDate != saved.EndDate || len(saved.Cities) > 0 {
		return nil, ErrReportInvalid
	}
	page, ok := decoded["page"].(float64)
	if !ok || page < 1 || page > 100 || page != float64(int(page)) {
		return nil, ErrReportInvalid
	}
	base := &model.ReportAnalyticsResult{StartDate: saved.StartDate, EndDate: saved.EndDate}
	queries, keys, err := buildV12AggregateQueries(report, base, nil)
	if err != nil {
		return nil, err
	}
	key := strings.TrimPrefix(saved.QueryKey, "prepared_")
	var query map[string]any
	for i, k := range keys {
		if key == k && i < 3 {
			query = preparedCityQuery(queries[i])
		}
	}
	for _, group := range []string{"all", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "gt10"} {
		if key != "order_count_"+group && key != "order_total_"+group {
			continue
		}
		q, e := buildOrderCountQueries(report, base, nil, group)
		if e != nil {
			return nil, e
		}
		if key == "order_count_"+group {
			query = preparedCityQuery(q[0])
		} else {
			query = q[1]
		}
	}
	if query == nil {
		return nil, ErrReportInvalid
	}
	size, ok := decoded["pageSize"].(float64)
	if !ok || (size != 1000 && size != 10000) {
		return nil, ErrReportInvalid
	}
	query["needPagination"], query["pageSize"], query["page"] = true, int(size), int(page)
	return query, nil
}
