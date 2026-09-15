package service

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/google/uuid"
	"golang.org/x/sync/errgroup"
	"log/slog"
	"sort"
	"sync/atomic"
	"time"
)

// 初始化补齐所有历史城市汇总；每日更新最新分区，失败保留已发布结果。
func (r *ReportRunner) prepareReportHistory(ctx context.Context, report *model.ReportDefinition, source *model.ReportDataSource, refreshDays int) error {
	r.preparedJobMu.Lock()
	defer r.preparedJobMu.Unlock()
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
		var failed atomic.Int32
		workers, workCtx := errgroup.WithContext(ctx)
		// 线上四路会触发上游30秒执行保护；两路配合大页聚合减少重复扫描。
		workers.SetLimit(2)
		cutoff := "9999-12-31"
		if refreshDays > 0 && len(directory.AvailableDates) > 0 {
			latest, _ := time.Parse("2006-01-02", directory.AvailableDates[0])
			cutoff = latest.AddDate(0, 0, 1-refreshDays).Format("2006-01-02")
		}
		for _, date := range directory.AvailableDates {
			if date < "2026-07-29" {
				continue
			}
			if exists[date] && date < cutoff {
				continue
			}
			if workCtx.Err() != nil {
				break
			}
			date := date
			workers.Go(func() error {
				if err := workCtx.Err(); err != nil {
					return err
				}
				started := time.Now()
				slog.Info("report.prepare.begin", "report_id", report.ID, "date", date)
				day, err := r.buildPreparedDay(workCtx, report, source, contract, date)
				if err == nil {
					err = store.SavePreparedReportDay(workCtx, prefix, report.ID, day)
					if err == nil {
						r.preparedMu.Lock()
						delete(r.preparedCache, prefix)
						r.preparedMu.Unlock()
					}
				}
				if err != nil {
					failures := failed.Add(1)
					slog.Error("report.prepare.failed", "report_id", report.ID, "date", date, "error", redactReportTrace(err.Error(), source))
					if failures >= 3 {
						return fmt.Errorf("%w: 三次预计算失败，保留既有快照", ErrReportInvalid)
					}
					return nil
				}
				slog.Info("report.prepare.published", "report_id", report.ID, "date", date, "duration_ms", time.Since(started).Milliseconds())
				return nil
			})
		}
		if err := workers.Wait(); err != nil {
			return nil, err
		}
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if failed.Load() > 0 {
			return nil, fmt.Errorf("%w: %d 个日期预计算失败，已保留成功快照", ErrReportInvalid, failed.Load())
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
		refreshDays := 31
		if trigger == "startup" {
			refreshDays = 0
		} else if trigger == "scheduled" {
			refreshDays = 1
		}
		err := r.prepareReportHistory(jobCtx, report, source, refreshDays)
		if err == nil {
			contract, e := r.catalog.(reportContractReader).GetReportDataSourceContract(jobCtx, source.ID)
			if e != nil {
				err = e
			} else {
				result, e := r.readPreparedAnalytics(jobCtx, report, source, contract, &model.ReportAnalyticsResult{StartDate: "2026-07-28", EndDate: reportBusinessYesterday(r.now()), Range: "all"}, nil)
				if e != nil {
					err = e
				} else {
					job.SourcePartition = result.DataDate
					job.SnapshotJSON, err = json.Marshal([]any{result})
				}
			}
		}
		statusCtx, statusCancel := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer statusCancel()
		finished := r.now()
		job.FinishedAt = &finished
		job.DurationMS = finished.Sub(job.StartedAt).Milliseconds()
		if err != nil {
			job.Status = model.ReportRunFailed
			job.ErrorMessage = redactReportTrace(err.Error(), source)
			err = r.runs.FailReportRun(statusCtx, &job)
		} else {
			job.Status = model.ReportRunSucceeded
			err = r.runs.CompleteReportRun(statusCtx, &job)
		}
		if err != nil {
			slog.Error("report.prepare.run_status_failed", "report_id", report.ID, "error", err)
		}
	}()
	return run, nil
}
