package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/121dico/Di-Agent/src/backend/internal/port"
)

var ErrReportSourceTimeBusy = errors.New("已有数据源时间核验正在运行，请稍后重试")

// 仅内部保留原始原因，日志与HTTP响应不输出它。
type sourceTimeQueryError struct {
	kind string
	err  error
}

func (e *sourceTimeQueryError) Error() string { return e.kind }
func (e *sourceTimeQueryError) Unwrap() error { return e.err }

func sourceTimeErrorKind(err error) string {
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "timeout"
	}
	if errors.Is(err, ErrReportCredentialsMissing) {
		return "credential"
	}
	if errors.Is(err, ErrReportInvalid) {
		return "contract"
	}
	var failure *sourceTimeQueryError
	if errors.As(err, &failure) {
		return failure.kind
	}
	return "invalid_result"
}

// SourceTimeCoverage 打开目录仅读缓存，显式核验全服务串行且最多120秒。
func (s *ReportService) SourceTimeCoverage(ctx context.Context, userID, sourceID string, refresh bool) (*model.ReportSourceTimeCoverage, error) {
	if err := s.requireAdmin(ctx, userID); err != nil {
		return nil, err
	}
	store, ok := s.store.(port.ReportSourceTimeStore)
	if !ok {
		return nil, errors.New("source time store unavailable")
	}
	if refresh {
		if !s.sourceTimeMu.TryLock() {
			return nil, ErrReportSourceTimeBusy
		}
		defer s.sourceTimeMu.Unlock()
	}
	source, err := s.store.GetReportDataSource(ctx, sourceID)
	if err != nil {
		return nil, fmt.Errorf("get time source: %w", err)
	}
	if source == nil {
		return nil, ErrReportSourceMissing
	}
	contract, err := s.store.GetReportDataSourceContract(ctx, sourceID)
	if err != nil {
		return nil, fmt.Errorf("get time contract: %w", err)
	}
	fingerprint := sourceTimeFingerprint(source, contract)
	v, err := store.GetSourceTimeCoverage(ctx, sourceID)
	if err != nil {
		return nil, err
	}
	if v == nil {
		v = &model.ReportSourceTimeCoverage{SourceID: sourceID, Status: "unchecked", Fingerprint: fingerprint}
	}
	if v.Fingerprint != fingerprint {
		v.Status = "stale"
	}
	if !refresh {
		return v, nil
	}
	if !source.Enabled || contract == nil || !contract.Enabled {
		return nil, fmt.Errorf("%w: 数据源或字段契约未启用", ErrReportInvalid)
	}
	// 保留旧版本及指纹；只有全套核验成功才替换，失败时仍明确标记过期。
	stale := v.Fingerprint != fingerprint
	now := time.Now().UTC()
	v.AttemptedAt = &now
	queryCtx, cancel := context.WithTimeout(ctx, 120*time.Second)
	defer cancel()
	partition, business, queryErr := s.querySourceTime(queryCtx, *source, contract)
	if queryErr != nil {
		v.Status = "failed"
		if stale {
			v.Status = "stale"
		}
		v.Error = "核验失败：请检查日期字段权限、认证或上游服务后重试"
	} else {
		v.Fingerprint = fingerprint
		v.Status = "verified"
		v.Error = ""
		v.Partition = partition
		v.Business = business
		done := time.Now().UTC()
		v.CheckedAt = &done
	}
	// 客户端断开或上游超时仍有限时保存失败状态。
	saveCtx, saveCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer saveCancel()
	if err = store.SaveSourceTimeCoverage(saveCtx, v); err != nil {
		return nil, err
	}
	return v, nil
}

func sourceTimeFingerprint(source *model.ReportDataSource, contract *model.ReportDataSourceContract) string {
	raw, _ := json.Marshal(struct {
		Source   *model.ReportDataSource
		Contract *model.ReportDataSourceContract
	}{source, contract})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func (s *ReportService) querySourceTime(ctx context.Context, source model.ReportDataSource, contract *model.ReportDataSourceContract) (*model.ReportSourceTimeRange, *model.ReportSourceTimeRange, error) {
	fields := map[string]model.ReportFieldContract{}
	for _, field := range contract.Fields {
		if field.Enabled && !field.Sensitive {
			fields[field.Name] = field
		}
	}
	query := func(field, partition string) (_ *model.ReportSourceTimeRange, queryErr error) {
		defer func() {
			if queryErr != nil {
				stage := "dt"
				if field != "dt" {
					stage = "business"
				}
				slog.WarnContext(ctx, "report.source_time.failed", "source_id", source.ID, "stage", stage, "error_kind", sourceTimeErrorKind(queryErr))
			}
		}()
		if !fields[field].Aggregatable {
			return s.querySourceDateGroups(ctx, source, fields, field, partition)
		}
		q := map[string]any{"apiName": source.APIName, "fieldList": []any{map[string]any{"name": field, "alias": "start", "aggFunctionEnum": "MIN"}, map[string]any{"name": field, "alias": "end", "aggFunctionEnum": "MAX"}}, "needPagination": false, "useMockData": false, "queryTypeEnum": "SYNC"}
		if partition != "" {
			q["conditionList"] = []any{map[string]any{"name": "dt", "operatorEnum": "EQ", "value": partition}}
		}
		if err := validateQueryContractLevel(q, fields); err != nil {
			return nil, err
		}
		raw, err := json.Marshal(q)
		if err != nil {
			return nil, err
		}
		if s.runner == nil || s.runner.connector == nil {
			return nil, errors.New("source connector unavailable")
		}
		result, err := s.runner.connector.Query(ctx, source, raw)
		if err != nil {
			return nil, &sourceTimeQueryError{kind: "upstream", err: err}
		}
		if len(result.Rows) != 1 || result.Pagination.PageCount > 1 {
			return nil, errors.New("invalid date aggregate row count")
		}
		row := result.Rows[0]
		start, err := sourceTimeDate(row, "start")
		if err != nil {
			return nil, err
		}
		end, err := sourceTimeDate(row, "end")
		if err != nil {
			return nil, err
		}
		if (start == nil) != (end == nil) || (start != nil && *start > *end) {
			return nil, errors.New("invalid date aggregate bounds")
		}
		return &model.ReportSourceTimeRange{Field: field, Start: start, End: end, Empty: start == nil, Partition: partition}, nil
	}
	partition, err := query("dt", "")
	if err != nil {
		return nil, nil, err
	}
	var business *model.ReportSourceTimeRange
	field, exists := fields["order_date"]
	if partition.End != nil && exists && field.Selectable && (field.Aggregatable || (field.Groupable && field.Sortable)) && fields["dt"].Filterable {
		business, err = query("order_date", *partition.End)
	}
	return partition, business, err
}

func sourceTimeDate(row map[string]any, key string) (*string, error) {
	value, exists := row[key]
	if !exists {
		return nil, errors.New("date aggregate field missing")
	}
	if value == nil {
		return nil, nil
	}
	str, ok := value.(string)
	if !ok {
		return nil, errors.New("date aggregate is not a string")
	}
	date, err := time.Parse("2006-01-02", str)
	if err != nil || date.Format("2006-01-02") != str {
		return nil, errors.New("date aggregate is not ISO date")
	}
	return &str, nil
}
