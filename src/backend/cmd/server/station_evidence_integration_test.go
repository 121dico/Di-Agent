package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	reportinfra "github.com/121dico/Di-Agent/src/backend/internal/infrastructure/report"
	"github.com/121dico/Di-Agent/src/backend/internal/repository"
	"github.com/121dico/Di-Agent/src/backend/internal/service"
	"github.com/jmoiron/sqlx"
)

// TestStationEvidenceLive 不输出身份或凭据；显式环境下核验管理员服务路径。
func TestStationEvidenceLive(t *testing.T) {
	path := os.Getenv("STATION_EVIDENCE_TEST_CONFIG")
	if path == "" {
		t.Skip("需要显式配置真实数据源")
	}
	reportID, userID, station := os.Getenv("STATION_EVIDENCE_TEST_REPORT"), os.Getenv("STATION_EVIDENCE_TEST_USER"), os.Getenv("STATION_EVIDENCE_TEST_STATION")
	if reportID == "" || userID == "" || station == "" || station == "ALL" {
		t.Fatal("缺少报表、管理员或单个场站")
	}
	cfg, err := loadConfig(path)
	if err != nil {
		t.Fatal("配置加载失败")
	}
	db, err := sqlx.Connect("pgx", fmt.Sprintf("host=%s port=%d user=%s password=%s dbname=%s sslmode=%s", cfg.Database.Host, cfg.Database.Port, cfg.Database.User, cfg.Database.Password, cfg.Database.DBName, cfg.Database.SSLMode))
	if err != nil {
		t.Fatal("数据库连接失败")
	}
	defer db.Close()
	repo := repository.NewReportRepo(db)
	runner := service.NewReportRunner(repo, repo, reportinfra.NewHTTPConnector(&http.Client{Timeout: 45 * time.Second}, nil), repo)
	svc := service.NewReportService(repo, repository.NewUserRepo(db), runner)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	base, err := svc.QueryStationValidation(ctx, reportID, userID, false)
	if err != nil || len(base.AvailableDates) == 0 {
		t.Fatal("场站目录查询失败")
	}
	if station == "auto" {
		totals := map[string]int64{}
		for _, day := range base.Rows {
			if day.StationID != "ALL" {
				totals[day.StationID] += day.Users
			}
		}
		var largest int64
		station = ""
		for id, users := range totals {
			if users > largest {
				largest, station = users, id
			}
		}
		if station == "" {
			t.Fatal("没有可测试的单个场站")
		}
		t.Logf("selected_station=%s", station)
	}
	start, end := os.Getenv("STATION_EVIDENCE_TEST_START"), os.Getenv("STATION_EVIDENCE_TEST_END")
	if start == "" {
		start = base.AvailableDates[0]
	}
	if end == "" {
		end = base.AvailableDates[len(base.AvailableDates)-1]
	}
	for _, level := range []string{"HIGH", "VERY_HIGH"} {
		began := time.Now()
		result, err := svc.QueryStationScoreEvidence(ctx, reportID, userID, station, start, end, level, "2")
		if err != nil {
			t.Fatalf("%s 判分证据查询失败（不输出上游原始错误）", level)
		}
		matched := 0
		for _, c := range result.Cases {
			if c.Status == "matched" {
				matched++
				if c.LabelDate != c.LastDate || c.ConsumptionDays < 2 || c.Level != level {
					t.Fatal("案例快照口径不一致")
				}
			}
		}
		if len(result.Cases) > 20 {
			t.Fatal("案例数量超界")
		}
		t.Logf("level=%s range=%s..%s candidates=%d cases=%d matched=%d unavailable=%d elapsed=%s", level, start, end, result.CandidateCount, len(result.Cases), matched, len(result.Cases)-matched, time.Since(began))
	}
}
