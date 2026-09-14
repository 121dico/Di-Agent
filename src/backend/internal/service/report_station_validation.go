package service

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type stationValidationStore interface {
	GetStationValidation(context.Context, string, time.Time) (*model.StationValidationResult, error)
	SaveStationValidation(context.Context, string, string, *model.StationValidationResult, time.Time) error
}

// QueryStationValidation 是 V1.2 的独立验证附区，不改变主报表的单数据源绑定。
func (s *ReportService) QueryStationValidation(ctx context.Context, reportID, userID string, refresh bool) (*model.StationValidationResult, error) {
	if refresh {
		if err := s.requireAdmin(ctx, userID); err != nil {
			return nil, err
		}
	}
	report, err := s.store.GetReportDefinition(ctx, reportID)
	if err != nil {
		return nil, fmt.Errorf("get validation report: %w", err)
	}
	if report == nil || !report.Enabled {
		return nil, ErrReportNotFound
	}
	parent, err := s.store.GetReportDataSource(ctx, report.DataSourceID)
	if err != nil {
		return nil, fmt.Errorf("get parent source: %w", err)
	}
	if parent == nil || !parent.Enabled || parent.APIName != "price_sensitive_v1_2" {
		return nil, ErrReportInvalid
	}
	sources, err := s.store.ListReportDataSources(ctx)
	if err != nil {
		return nil, fmt.Errorf("list validation source: %w", err)
	}
	var source *model.ReportDataSource
	for i := range sources {
		if sources[i].Enabled && sources[i].APIName == "station_price_sensitive_test_detail" {
			if source != nil {
				return nil, fmt.Errorf("%w: 存在多个试点站数据源，请管理员确认", ErrReportInvalid)
			}
			source = &sources[i]
		}
	}
	if source == nil {
		return nil, ErrReportSourceMissing
	}
	contract, err := s.store.GetReportDataSourceContract(ctx, source.ID)
	if err != nil {
		return nil, fmt.Errorf("get validation contract: %w", err)
	}
	if err := validateStationContract(contract); err != nil {
		return nil, err
	}
	if s.runner == nil || s.runner.connector == nil {
		return nil, ErrReportSourceMissing
	}
	raw, err := json.Marshal([]interface{}{"station-validation-v1", report.ID, report.UpdatedAt, parent.ID, parent.UpdatedAt, source, contract.Fields})
	if err != nil {
		return nil, fmt.Errorf("encode validation cache key: %w", err)
	}
	key := fmt.Sprintf("station-validation:%x", sha256.Sum256(raw))
	cache, hasCache := s.store.(stationValidationStore)
	if hasCache && !refresh {
		cached, err := cache.GetStationValidation(ctx, key, s.runner.now())
		if err != nil {
			return nil, err
		}
		if cached != nil {
			return cached, nil
		}
	}
	// 首次加载与刷新共用同一执行锁，避免较旧查询晚返回后覆盖新缓存。
	value, err, _ := s.runner.templateQueries.Do(key, func() (interface{}, error) {
		result, err := s.runner.loadStationValidation(ctx, *source)
		if err != nil {
			return nil, err
		}
		if hasCache {
			// 有效期到北京时间次个10点，重进页面复用完整聚合，管理员可主动刷新重跑数据。
			now := s.runner.now().In(time.FixedZone("Asia/Shanghai", 8*60*60))
			expires := time.Date(now.Year(), now.Month(), now.Day(), 10, 0, 0, 0, now.Location())
			if !expires.After(now) {
				expires = expires.AddDate(0, 0, 1)
			}
			if err := cache.SaveStationValidation(ctx, key, reportID, result, expires); err != nil {
				return nil, err
			}
		}
		return result, nil
	})
	if err != nil {
		return nil, err
	}
	return value.(*model.StationValidationResult), nil
}

func validateStationContract(contract *model.ReportDataSourceContract) error {
	if contract == nil || !contract.Enabled {
		return ErrReportSourceMissing
	}
	fields := map[string]model.ReportFieldContract{}
	for _, f := range contract.Fields {
		if f.Enabled && !f.Sensitive {
			fields[f.Name] = f
		}
	}
	for _, name := range []string{"dt", "station_id", "station_name", "ps_level"} {
		f := fields[name]
		if !f.Selectable || !f.Groupable || !f.Sortable {
			return fmt.Errorf("%w: 验证字段 %s 未开放查询/分组/排序", ErrReportInvalid, name)
		}
	}
	for _, name := range []string{"dt", "duid", "label_match_status", "vehicle_type"} {
		if !fields[name].Filterable {
			return fmt.Errorf("%w: 验证字段 %s 未开放筛选", ErrReportInvalid, name)
		}
	}
	if !fields["duid"].Selectable || !fields["duid"].Aggregatable {
		return fmt.Errorf("%w: duid 未开放去重统计", ErrReportInvalid)
	}
	return nil
}
