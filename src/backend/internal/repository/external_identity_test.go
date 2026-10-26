package repository

import (
	"context"
	"os"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
)

// Opt-in only: use an isolated test PostgreSQL, never a production DSN. Each
// test uses its own schema and drops only that generated schema at completion.
func TestExternalIdentityPostgresConcurrentProvisioning(t *testing.T) {
	dsn := os.Getenv("DI_AGENT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires isolated test PostgreSQL in DI_AGENT_TEST_DATABASE_URL")
	}
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal("invalid test PostgreSQL configuration")
	}
	admin := sqlx.NewDb(stdlib.OpenDB(*cfg), "pgx")
	defer admin.Close()
	schema := "boss_auth_test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec(`CREATE SCHEMA ` + schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(`DROP SCHEMA ` + schema + ` CASCADE`)
	cfg.RuntimeParams["search_path"] = schema
	db := sqlx.NewDb(stdlib.OpenDB(*cfg), "pgx")
	defer db.Close()
	_, err = db.Exec(`CREATE TABLE users(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),username VARCHAR(50) UNIQUE NOT NULL,password_hash VARCHAR(255) NOT NULL,avatar TEXT NOT NULL DEFAULT '',is_admin BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := os.ReadFile("../../migrations/088_create_external_identities.sql")
	if err != nil {
		t.Fatal(err)
	}
	up := strings.Split(string(migration), "---- DOWN")[0]
	for i := 0; i < 2; i++ {
		if _, err = db.Exec(up); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = db.Exec(`INSERT INTO users(username,password_hash,is_admin)VALUES('alice','local-only',TRUE)`); err != nil {
		t.Fatal(err)
	}
	repo := NewUserRepo(db)
	var wg sync.WaitGroup
	ids := make(chan string, 12)
	errs := make(chan error, 12)
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u, e := repo.GetOrCreateExternalUser(context.Background(), "boss", "alice")
			if e != nil {
				errs <- e
				return
			}
			if u.Username == "alice" || u.IsAdmin || u.PasswordHash != "!external-auth-only" {
				errs <- errorsExternalPrivilege{}
				return
			}
			ids <- u.ID
		}()
	}
	wg.Wait()
	close(ids)
	close(errs)
	for e := range errs {
		t.Fatal(e)
	}
	id := ""
	for v := range ids {
		if id != "" && id != v {
			t.Fatal("same external identity created multiple users")
		}
		id = v
	}
	var count int
	if err = db.Get(&count, `SELECT count(*) FROM users`); err != nil || count != 2 {
		t.Fatalf("orphan users: count=%d err=%v", count, err)
	}
	u, err := repo.GetOrCreateExternalUser(context.Background(), "boss", "bob")
	if err != nil || u.ID == id {
		t.Fatal("different subject reused identity", err)
	}
}

type errorsExternalPrivilege struct{}

func (errorsExternalPrivilege) Error() string {
	return "external user merged with local identity or gained privilege"
}
