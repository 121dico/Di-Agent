package service

import (
	"context"
	"fmt"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/google/uuid"
	"log/slog"
	"sort"
	"time"
)

// 初始化补齐所有历史城市汇总；每日更新最新分区，失败保留已发布结果。
func (r *ReportRunner) prepareReportHistory(ctx context.Context, report *model.ReportDefinition, source *model.ReportDataSource, refresh bool) error {
	contract, err := r.catalog.(reportContractReader).GetReportDataSourceContract(ctx, source.ID)
	if err != nil {
		return err
	}
	if contract == nil || !contract.Enabled || !source.Enabled {
		return ErrReportSourceMissing
	}
	prefix := preparedPrefix(report, source, contract)
	_, err, _ = r.templateQueries.Do(prefix, func() (any, error) {
		store := r.catalog.(reportPreparedStore)
		saved, err := store.ListPreparedReportDays(ctx, prefix)
		if err != nil {
			return nil, err
		}
		exists := map[string]bool{}
		for _, day := range saved {
			exists[day.Date] = true
		}
		base := &model.ReportAnalyticsResult{Range: "dates", StartDate: "2026-07-28", EndDate: reportBusinessYesterday(r.now())}
		// 日期目录跨日，走已验证的标准目录查询，不携带城市条件。
		directory, err := r.queryV12Analytics(ctx, report, source, base, ReportAnalyticsOptions{ForceRefresh: true})
		if err != nil {
			return nil, err
		}
		sort.Sort(sort.Reverse(sort.StringSlice(directory.AvailableDates)))
		var failed int
		for i, date := range directory.AvailableDates {
			if date < "2026-07-29" {
				continue
			}
			if exists[date] && !(refresh && i == 0) {
				continue
			}
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			slog.Info("report.prepare.begin", "report_id", report.ID, "date", date)
			day, err := r.buildPreparedDay(ctx, report, source, contract, date)
			if err == nil {
				err = store.SavePreparedReportDay(ctx, prefix, report.ID, day)
			}
			if err != nil {
				failed++
				slog.Error("report.prepare.failed", "report_id", report.ID, "date", date, "error", redactReportTrace(err.Error(), source))
				if failed >= 3 {
					return nil, fmt.Errorf("%w: 连续预计算失败，保留既有快照", ErrReportInvalid)
				}
				continue
			}
			slog.Info("report.prepare.published", "report_id", report.ID, "date", date)
		}
		if failed > 0 {
			return nil, fmt.Errorf("%w: %d 个日期预计算失败，已保留成功快照", ErrReportInvalid, failed)
		}
		return nil, nil
	})
	return err
}

func (r *ReportRunner) startPreparedRun(ctx context.Context, report *model.ReportDefinition, source *model.ReportDataSource, trigger, user string) (*model.ReportRun, error) {
	run := &model.ReportRun{ID: uuid.NewString(), ReportID: report.ID, Trigger: trigger, RequestedBy: user, Status: model.ReportRunPending, StartedAt: r.now()}
	if err := r.runs.StartReportRun(ctx, run); err != nil {
		return nil, err
	}
	job := *run
	go func() {
		jobCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 12*time.Hour)
		defer cancel()
		err := r.prepareReportHistory(jobCtx, report, source, trigger != "startup")
		finished := r.now()
		job.FinishedAt = &finished
		job.DurationMS = finished.Sub(job.StartedAt).Milliseconds()
		if err != nil {
			job.Status = model.ReportRunFailed
			job.ErrorMessage = redactReportTrace(err.Error(), source)
			err = r.runs.FailReportRun(jobCtx, &job)
		} else {
			job.Status = model.ReportRunSucceeded
			job.SnapshotJSON = []byte("[]")
			job.SourcePartition = reportBusinessYesterday(r.now())
			err = r.runs.CompleteReportRun(jobCtx, &job)
		}
		if err != nil {
			slog.Error("report.prepare.run_status_failed", "report_id", report.ID, "error", err)
		}
	}()
	return run, nil
}
