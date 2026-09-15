package service

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strconv"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// 明确允许的证据字段；接口多返回的列也不能越过此边界泄漏。
var stationEvidenceFields = []string{
	"duid", "dt", "ps_score", "ps_level", "ps_type", "ps_conf", "ps_update_dt", "ps_version",
	"order_cnt_180d", "ps_order_cnt", "last_order_time", "price_cmp_cnt", "cheap_cnt", "same_cnt", "expensive_cnt", "price_dir_idx",
	"valley_valid_cnt", "valley_order_cnt", "valley_rate", "sort_confirm_cnt", "price_score", "price_status",
	"coupon_used_cnt", "coupon_expired_cnt", "coupon_total_cnt", "coupon_use_rate", "coupon_score", "coupon_status",
	"time_cmp_cnt", "busy_order_cnt", "busy_low_cnt", "busy_low_rate", "busy_station_cnt", "busy_date_cnt", "time_score", "time_status",
	"is_vip", "vehicle_type", "vehicle_brand", "vehicle_factor", "brand_factor", "member_factor", "profile_factor", "dim_cnt", "prior_score", "base_score",
}

func (r *ReportRunner) loadStationScoreCase(ctx context.Context, source model.ReportDataSource, available map[string]model.ReportFieldContract, item *model.StationScoreCase) error {
	item.Status, item.Reason = "unavailable", ""
	item.Fields = map[string]interface{}{}
	item.ObservedContributions = map[string]*float64{"price": nil, "coupon": nil, "time": nil}
	if item.LabelDate != item.LastDate {
		item.Reason = "场站标签日期与最后消费日不一致，不使用其他日期标签归因"
		return nil
	}
	fields := []map[string]interface{}{}
	selected := []string{}
	for _, name := range stationEvidenceFields {
		f := available[name]
		if f.Enabled && !f.Sensitive && f.Selectable {
			fields = append(fields, analyticsField(name, "", ""))
			selected = append(selected, name)
		}
	}
	query := map[string]interface{}{
		"fieldList": fields, "conditionList": []map[string]interface{}{{"name": "duid", "operatorEnum": "EQ", "value": item.DUID}, {"name": "dt", "operatorEnum": "EQ", "value": item.LabelDate}},
		"orderBy": "duid", "needPagination": true, "pageSize": 2, "page": 1, "disableCache": true, "useMockData": false, "queryTypeEnum": "SYNC",
	}
	raw, err := json.Marshal(query)
	if err != nil {
		return err
	}
	var governed map[string]interface{}
	if err := json.Unmarshal(raw, &governed); err != nil {
		return err
	}
	if err := validateQueryContractLevel(governed, available); err != nil {
		return err
	}
	result, err := r.connector.Query(ctx, source, raw)
	if err != nil {
		return fmt.Errorf("%w: 同日标签查询失败，请稍后重试", ErrReportInvalid)
	}
	if result.Pagination.Total == 0 && len(result.Rows) == 0 {
		item.Reason = "同一用户同日V1.2快照不存在"
		return nil
	}
	if result.Pagination.Total != 1 || len(result.Rows) != 1 {
		item.Reason = "同日标签不唯一或分页不完整，无法可靠解释"
		return nil
	}
	row := result.Rows[0]
	if fmt.Sprint(row["duid"]) != item.DUID || row["dt"] != item.LabelDate || row["ps_level"] != item.Level {
		item.Reason = "同日V1.2标签与场站记录不一致，请核查上游同步"
		return nil
	}
	if f := available["ps_score"]; f.Enabled && !f.Sensitive && f.Selectable && row["ps_score"] != nil {
		score, err := strconv.ParseFloat(fmt.Sprint(row["ps_score"]), 64)
		if err != nil || math.IsNaN(score) || math.IsInf(score, 0) || score < 0 || score > 100 || (item.Level == "VERY_HIGH" && score < 80) || (item.Level == "HIGH" && (score < 70 || score >= 80)) {
			item.Reason = "标签分数与提供SQL的高/极高阈值不一致，不作判分归因"
			return nil
		}
	}
	missing := false
	for _, name := range selected {
		if name == "duid" {
			continue
		}
		v, ok := row[name]
		if !ok || v == nil {
			missing = true
			item.Fields[name] = nil
			continue
		}
		switch typed := v.(type) {
		case string, json.Number, float64, int64, int:
			item.Fields[name] = typed
		default:
			return fmt.Errorf("%w: 标签字段格式异常", ErrReportInvalid)
		}
	}
	for name, weight := range map[string]float64{"price": 0.5, "coupon": 0.3, "time": 0.2} {
		value := item.Fields[name+"_score"]
		if value == nil {
			continue
		}
		n, err := strconv.ParseFloat(fmt.Sprint(value), 64)
		if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > 100 {
			return fmt.Errorf("%w: 观测维度分数无效", ErrReportInvalid)
		}
		contribution := n * weight
		item.ObservedContributions[name] = &contribution
	}
	item.Status = "matched"
	item.Reason = "同日快照匹配；50/30/20仅为按提供SQL计算的观测维度贡献，不代表全部归因，缺失维度先验及画像修正不作推测"
	if missing || len(selected) < len(stationEvidenceFields) {
		item.Reason += "；部分字段未开放或无证据"
	}
	return nil
}
