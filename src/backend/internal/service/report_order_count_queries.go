package service

import (
	"encoding/json"
	"reflect"
	"strings"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func reportChartBindingsForQuery(key string) []model.ReportChartBinding {
	if strings.HasPrefix(key, "order_count_") {
		return []model.ReportChartBinding{{ChartKey: "order_count_distribution", Title: "按订单笔数的价敏分布", QueryKeys: []string{"order_count_distribution", "order_count_total", "order_count_snapshot"}, Formula: "所选dt及订单笔数，ps_conf>0且duid>0；各级COUNT_DISTINCT(duid)除以独立去重总人数。", FieldMapping: map[string]string{"level": "ps_level", "count": "user_count", "orders": "order_cnt_180d"}}}
	}
	return v12ChartBindings()
}

// 共用固定生成器；核验重跑只接受与现行白名单查询完全一致的请求。
func buildOrderCountQueries(report *model.ReportDefinition, base *model.ReportAnalyticsResult, cities []string, orders string) ([]map[string]any, error) {
	queries, _, err := buildV12AggregateQueries(report, base, cities)
	if err != nil {
		return nil, err
	}
	q := queries[2]
	existence := map[string]any{"fieldList": []map[string]any{analyticsField("dt", "", "")}, "conditionList": queries[0]["conditionList"], "groupList": []string{"dt"}, "orderBy": "dt"}
	conditions := append(q["conditionList"].([]map[string]any), map[string]any{"name": "duid", "operatorEnum": "GQ", "value": "0"})
	if orders != "all" {
		op, value := "EQ", orders
		if orders == "gt10" {
			op, value = "GQ", "10"
		}
		conditions = append(conditions, map[string]any{"name": "order_cnt_180d", "operatorEnum": op, "value": value})
	}
	q["conditionList"] = conditions
	q["fieldList"] = []map[string]any{analyticsField("dt", "", ""), analyticsField("ps_level", "level", ""), analyticsField("duid", "user_count", "COUNT_DISTINCT")}
	total := map[string]any{"fieldList": []map[string]any{analyticsField("dt", "", ""), analyticsField("duid", "user_count", "COUNT_DISTINCT")}, "conditionList": conditions, "groupList": []string{"dt"}, "orderBy": "dt"}
	result := []map[string]any{q, total, existence}
	for _, query := range result {
		query["needPagination"], query["pageSize"], query["page"] = true, 1000, 1
	}
	return result, nil
}

func trustedOrderCountReplay(report *model.ReportDefinition, source *model.ReportDataSource, saved *model.ReportQueryExecution, decoded map[string]any) (map[string]any, error) {
	index, ok := map[string]int{"order_count_distribution": 0, "order_count_total": 1, "order_count_snapshot": 2}[saved.QueryKey]
	if !ok || saved.StartDate != saved.EndDate {
		return nil, ErrReportInvalid
	}
	for _, orders := range []string{"all", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "gt10"} {
		queries, err := buildOrderCountQueries(report, &model.ReportAnalyticsResult{StartDate: saved.StartDate, EndDate: saved.EndDate}, saved.Cities, orders)
		if err != nil {
			return nil, err
		}
		query := queries[index]
		query["apiName"] = source.APIName
		raw, err := json.Marshal(query)
		if err != nil {
			return nil, err
		}
		var trusted map[string]any
		if err := json.Unmarshal(raw, &trusted); err != nil {
			return nil, err
		}
		if reflect.DeepEqual(trusted, decoded) {
			return query, nil
		}
	}
	return nil, ErrReportInvalid
}
