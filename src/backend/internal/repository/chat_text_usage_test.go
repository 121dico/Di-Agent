package repository

import (
	"context"
	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/jmoiron/sqlx"
	"os"
	"testing"
	"time"
)

func TestChatTextVisibilityAndNativeModelClockSkew(t *testing.T) {
	dsn := os.Getenv("DI_AGENT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires isolated PostgreSQL")
	}
	db, err := sqlx.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	_, err = db.Exec(`CREATE TEMP TABLE messages(id text,conversation_id text,sender_id text,role text,content text,blocks_json text,artifacts_json text,status text,deleted_at timestamptz);
 CREATE TEMP TABLE message_hides(message_id text,user_id text);
 INSERT INTO messages VALUES
 ('1','c','me','user','hello','','','complete',NULL),
 ('2','c','other','user','private','','','complete',NULL),
 ('3','c','me','user','hidden','','','complete',NULL),
 ('4','c','me','user','withdrawn','','','complete',NOW()),
 ('5','c',NULL,'assistant','reply','','{"agent_id":"a"}','complete',NULL),
 ('6','c','a','assistant','direct','','','complete',NULL),
 ('7','c',NULL,'assistant','other reply','','{"agent_id":"b"}','complete',NULL),
 ('8','c',NULL,'assistant','streaming','','{"agent_id":"a"}','streaming',NULL);
 INSERT INTO message_hides VALUES('3','me');
 CREATE TEMP TABLE agents(id text,machine_id text);
 INSERT INTO agents VALUES('a','machine');
 CREATE TEMP TABLE agent_model_runtime(agent_id text PRIMARY KEY,configured_model text DEFAULT '',observed_model text DEFAULT '',context_window bigint,observed_at timestamptz DEFAULT NOW());`)
	if err != nil {
		t.Fatal(err)
	}
	repo := NewMessageRepo(db, nil, nil)
	ctx := context.Background()
	own, err := repo.ListOwnMessageTexts(ctx, "me", "c")
	if err != nil || len(own) != 1 || own[0] != "hello" {
		t.Fatalf("visibility: %v %v", own, err)
	}
	replies, err := repo.ListAgentReplyTexts(ctx, "me", "c", "a")
	if err != nil || len(replies) != 2 {
		t.Fatalf("reply identity: %v %v", replies, err)
	}
	runtime := NewAgentSessionRepo(db)
	if err = runtime.SaveConfiguredModel(ctx, "a", "machine", "configured"); err != nil {
		t.Fatal(err)
	}
	if err = runtime.SaveObservedModel(ctx, "a", &model.TokenUsage{Model: "actual", ObservedAt: time.Now().Add(-time.Hour)}); err != nil {
		t.Fatal(err)
	}
	var actual string
	if err = db.Get(&actual, `SELECT observed_model FROM agent_model_runtime WHERE agent_id='a'`); err != nil || actual != "actual" {
		t.Fatalf("clock skew hid native model: %s %v", actual, err)
	}
}
