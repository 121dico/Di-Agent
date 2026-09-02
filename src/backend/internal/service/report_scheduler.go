package service

import (
	"context"
	"log/slog"
	"sync"
	"time"
)

// ReportScheduler 每天北京时间 10:00 复用 ReportRunner 生成固定报表。
type ReportScheduler struct {
	reports *ReportService
	runner  *ReportRunner
	logger  *slog.Logger
	mu      sync.Mutex
	lastDay string
}

func NewReportScheduler(reports *ReportService, runner *ReportRunner, logger *slog.Logger) *ReportScheduler {
	return &ReportScheduler{reports: reports, runner: runner, logger: logger}
}

func (s *ReportScheduler) Start(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case now := <-ticker.C:
				s.runIfDue(ctx, now)
			}
		}
	}()
}

func (s *ReportScheduler) runIfDue(ctx context.Context, now time.Time) {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		loc = time.FixedZone("CST", 8*60*60)
	}
	local := now.In(loc)
	if local.Hour() != 10 {
		return
	}
	day := local.Format("2006-01-02")
	s.mu.Lock()
	if s.lastDay == day {
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()
	reports, err := s.reports.EnabledDefinitions(ctx)
	if err != nil {
		s.logger.Error("list scheduled reports failed", "error", err)
		return
	}
	s.mu.Lock()
	s.lastDay = day
	s.mu.Unlock()
	for _, report := range reports {
		if _, err := s.runner.Run(ctx, report.ID, "scheduled", ""); err != nil {
			s.logger.Error("scheduled report failed", "report_id", report.ID, "error", err)
		}
	}
}
