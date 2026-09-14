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

// TestStationPeopleLive 仅在明确指定配置与报表时运行，不迁移数据库，不输出用户标识或凭据。
func TestStationPeopleLive(t *testing.T) {
	path := os.Getenv("STATION_PEOPLE_TEST_CONFIG")
	if path == "" {
		t.Skip("需要显式配置真实数据源集成测试")
	}
	reportID, userID := os.Getenv("STATION_PEOPLE_TEST_REPORT"), os.Getenv("STATION_PEOPLE_TEST_USER")
	if reportID == "" || userID == "" {
		t.Fatal("缺少测试报表或调用用户")
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
	if err != nil {
		t.Fatal("宏观验证查询失败；请检查服务端诊断，不输出上游原始错误")
	}
	if len(base.AvailableDates) == 0 {
		t.Fatal("数据源没有可用日期")
	}
	start, end := base.AvailableDates[0], base.AvailableDates[len(base.AvailableDates)-1]
	began := time.Now()
	result, err := svc.QueryStationPeople(ctx, reportID, userID, "ALL", start, end, false)
	if err != nil {
		t.Fatal("用户复购查询失败；请检查服务端诊断，不输出上游原始错误")
	}
	t.Logf("range=%s..%s days=%d users=%d repeat=%d multi_day=%d cross_station=%d elapsed=%s", start, end, len(result.Days), result.Users, result.RepeatUsers, result.MultiDayUsers, result.CrossStationUsers, time.Since(began))
	for _, day := range result.Days {
		if day.New+day.Returning != day.Users {
			t.Fatal("每日新老用户不守恒")
		}
	}
	began = time.Now()
	cached, err := svc.QueryStationPeople(ctx, reportID, userID, "ALL", start, end, false)
	if err != nil || cached == nil || cached.FetchedAt != result.FetchedAt || cached.Users != result.Users {
		t.Fatal("缓存复用失败")
	}
	t.Logf("cache_elapsed=%s", time.Since(began))
}
