package repository

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
)

// 使用已迁移的隔离数据库。临时表沿用真实schema，不写入产品的计量记录。
func TestNativeUsagePostgresReplayAndLateArrival(t *testing.T) {
	dsn := os.Getenv("DI_AGENT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires isolated migrated PostgreSQL")
	}
	db, err := sqlx.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(`CREATE TEMP TABLE agent_token_usage (LIKE public.agent_token_usage INCLUDING ALL)`); err != nil {
		t.Fatal(err)
	}
	repo := NewAgentSessionRepo(db)
	session := &model.AgentSession{ID: uuid.NewString(), ConversationID: uuid.NewString(), AgentID: uuid.NewString()}
	n, out, capacity := int64(12000), int64(1000), int64(1000000)
	newer := &model.TokenUsage{Provider: "codex", Source: "actual", InputTokens: &n, OutputTokens: &out, ContextTokens: &n, ContextWindowTokens: &capacity, Complete: true, ObservedAt: time.Now()}
	currentID := uuid.NewString()
	for i := 0; i < 2; i++ {
		if err := repo.SaveNativeUsage(context.Background(), session, currentID, newer); err != nil {
			t.Fatal(err)
		}
	}
	m := int64(10000)
	older := *newer
	older.InputTokens = &m
	older.ContextTokens = &m
	older.ObservedAt = newer.ObservedAt.Add(-time.Minute)
	if err := repo.SaveNativeUsage(context.Background(), session, uuid.NewString(), &older); err != nil {
		t.Fatal(err)
	}
	if err := repo.ReadNativeUsage(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	if session.MeasuredTurns != 2 || *session.NativeTotals.InputTokens != 22000 || *session.NativeUsage.ContextTokens != 12000 {
		t.Fatalf("wrong native snapshots: %+v %+v", session.NativeTotals, session.NativeUsage)
	}
	// 同任务过期更新不能覆盖已收到的新样本。
	if err := repo.SaveNativeUsage(context.Background(), session, currentID, &older); err != nil {
		t.Fatal(err)
	}
	if err := repo.ReadNativeUsage(context.Background(), session); err != nil {
		t.Fatal(err)
	}
	if *session.NativeTotals.InputTokens != 22000 {
		t.Fatal("stale replay changed totals")
	}
}
