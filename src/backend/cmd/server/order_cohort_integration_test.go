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

// TestOrderCohortLive 显式选择真实环境；仅查询聚合并复用缓存，不输出明细与凭据。
func TestOrderCohortLive(t *testing.T) {
	path := os.Getenv("ORDER_COHORT_TEST_CONFIG")
	if path == "" {
		t.Skip("未配置真实环境")
	}
	reportID, date := os.Getenv("ORDER_COHORT_TEST_REPORT"), os.Getenv("ORDER_COHORT_TEST_DATE")
	if reportID == "" || date == "" {
		t.Fatal("缺少报表或日期")
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
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	defer cancel()
	var all, sum int64
	for _, orders := range []string{"all", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "gt10"} {
		began := time.Now()
		result, err := runner.QueryOrderCohort(ctx, reportID, date, orders, nil)
		if err != nil || result.OrderCohort == nil {
			t.Fatalf("orders=%s 聚合失败；查看服务端诊断", orders)
		}
		if orders == "all" {
			all = result.OrderCohort.UserCount
		} else {
			sum += result.OrderCohort.UserCount
		}
		t.Logf("orders=%s total=%d cached=%t elapsed=%s", orders, result.OrderCohort.UserCount, result.Cached, time.Since(began))
		for _, group := range result.OrderCohort.Distribution {
			t.Logf("  %s %d", group.Level, group.UserCount)
		}
	}
	if sum != all {
		t.Fatal("各笔数分组合计与全部有订单人数不一致")
	}
	result, err := runner.QueryOrderCohort(ctx, reportID, date, "1", nil)
	if err != nil || !result.Cached {
		t.Fatal("未复用聚合缓存")
	}
}
