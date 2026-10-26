package repository

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
)

// 使用独立测试库和随机 schema；禁止指向生产数据库。
func machineRemovalDB(t *testing.T) *sqlx.DB {
	t.Helper()
	dsn := os.Getenv("DI_AGENT_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires isolated DI_AGENT_TEST_DATABASE_URL")
	}
	cfg, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	admin := sqlx.NewDb(stdlib.OpenDB(*cfg), "pgx")
	schema := "machine_remove_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = admin.Exec("CREATE SCHEMA " + schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Exec("DROP SCHEMA " + schema + " CASCADE"); admin.Close() })
	cfg.RuntimeParams["search_path"] = schema
	db := sqlx.NewDb(stdlib.OpenDB(*cfg), "pgx")
	t.Cleanup(func() { db.Close() })
	for _, file := range []string{"001_create_users.sql", "002_create_conversations.sql", "003_create_messages.sql", "005_create_conversation_members.sql", "007_create_agents.sql", "009_create_daemon_machines.sql", "011_create_daemon_agent_candidates.sql", "012_allow_multiple_agents_per_cli.sql", "015_create_daemon_tasks.sql", "017_create_conversation_agents.sql", "047_unique_orchestrator_per_conversation.sql", "059_create_conversation_checkpoints.sql", "061_create_conversation_forks.sql"} {
		b, err := os.ReadFile("../../migrations/" + file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.Exec(strings.Split(string(b), "---- DOWN")[0]); err != nil {
			t.Fatalf("%s: %v", file, err)
		}
	}
	_, err = db.Exec(`ALTER TABLE agents ADD COLUMN runtime_variant TEXT NOT NULL DEFAULT 'cli', ADD COLUMN tools_config TEXT NOT NULL DEFAULT '', ADD COLUMN custom_skills TEXT NOT NULL DEFAULT '', ADD COLUMN tags TEXT NOT NULL DEFAULT '', ADD COLUMN enable_management_tools BOOLEAN NOT NULL DEFAULT FALSE; ALTER TABLE daemon_machines ADD COLUMN capabilities TEXT NOT NULL DEFAULT '[]'`)
	if err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile("../../migrations/091_retire_machine_agents.sql"); err == nil {
		for i := 0; i < 2; i++ {
			if _, err = db.Exec(strings.Split(string(b), "---- DOWN")[0]); err != nil {
				t.Fatal(err)
			}
		}
	}
	return db
}

func TestRemoveMachinePreservesCheckpointAndFork(t *testing.T) {
	for _, state := range []string{"offline", "connected"} {
		t.Run(state, func(t *testing.T) {
			db := machineRemovalDB(t)
			ctx := context.Background()
			u, other, a, conv, child, msg, checkpoint := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
			for _, id := range []string{u, other} {
				if _, err := db.Exec(`INSERT INTO users(id,username,password_hash) VALUES($1,$2,'test')`, id, id); err != nil {
					t.Fatal(err)
				}
			}
			r := NewAgentRepo(db)
			m, err := r.CreateDaemonMachine(ctx, u, "test-machine", "hash-for-test")
			if err != nil {
				t.Fatal(err)
			}
			_, err = db.Exec(`UPDATE daemon_machines SET status=$2 WHERE id=$1;`, m.ID, state)
			if err != nil {
				t.Fatal(err)
			}
			_, err = db.Exec(`INSERT INTO agents(id,user_id,name,type,cli_tool,machine_id,source) VALUES($1,$2,'Codex','custom','codex',$3,'daemon')`, a, u, m.ID)
			if err != nil {
				t.Fatal(err)
			}
			for _, id := range []string{conv, child} {
				if _, err = db.Exec(`INSERT INTO conversations(id,user_id,title) VALUES($1,$2,'history')`, id, u); err != nil {
					t.Fatal(err)
				}
			}
			if _, err = db.Exec(`INSERT INTO messages(id,conversation_id,role,content) VALUES($1,$2,'user','keep this history')`, msg, conv); err != nil {
				t.Fatal(err)
			}
			if _, err = db.Exec(`INSERT INTO conversation_agents(conversation_id,agent_id,added_by,role) VALUES($1,$2,$3,'orchestrator')`, conv, a, u); err != nil {
				t.Fatal(err)
			}
			if _, err = db.Exec(`INSERT INTO daemon_tasks(user_id,conversation_id,agent_id,machine_id,cli_tool,prompt,status,result) VALUES($1,$2,$3,$4,'codex','original task','completed','saved result')`, u, conv, a, m.ID); err != nil {
				t.Fatal(err)
			}
			if _, err = db.Exec(`INSERT INTO conversation_checkpoints(id,conversation_id,source_agent_id,version,source_from_message_id,source_to_message_id,source_message_count,created_by) VALUES($1,$2,$3,1,$4,$4,1,$5)`, checkpoint, conv, a, msg, u); err != nil {
				t.Fatal(err)
			}
			if _, err = db.Exec(`INSERT INTO conversation_forks(child_conversation_id,parent_conversation_id,checkpoint_id,forked_from_message_id,source_agent_id,target_agent_id,created_by) VALUES($1,$2,$3,$4,$5,$5,$6)`, child, conv, checkpoint, msg, a, u); err != nil {
				t.Fatal(err)
			}
			if ok, err := r.DeleteDaemonMachine(ctx, m.ID, other); err != nil || ok {
				t.Fatalf("ownership: %v %v", ok, err)
			}
			pending, err := r.CreateDaemonTask(ctx, u, conv, a, m.ID, "codex", "cli", "test", "")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := r.CreateDaemonTask(ctx, other, conv, a, m.ID, "codex", "cli", "test", ""); err == nil {
				t.Fatal("private machine accepts different user")
			}
			if _, err = r.ClaimDaemonTask(ctx, m.ID); err != nil {
				t.Fatal(err)
			}
			if ok, err := r.DeleteDaemonMachine(ctx, m.ID, u); err != nil || !ok {
				t.Fatalf("remove %s computer with historical references: %v %v", state, ok, err)
			}
			if got, err := r.GetDaemonMachineByAPIKeyHash(ctx, "hash-for-test"); err != nil || got != nil {
				t.Fatalf("removed machine credential still usable: %v %v", got, err)
			}
			if list, err := r.ListAvailable(ctx, u); err != nil || len(list) != 0 {
				t.Fatalf("retired agents remain available: %v %v", list, err)
			}
			if got, err := r.GetByID(ctx, a); err != nil || got != nil {
				t.Fatalf("retired agent executable: %v %v", got, err)
			}
			if err := r.UpdateAgentStatus(ctx, a, "online"); err != nil {
				t.Fatal(err)
			}
			historical, err := NewConversationRepo(db).ListAgents(ctx, conv, u)
			if err != nil || len(historical) != 1 || historical[0].Name != "Codex" || historical[0].Status != "stopped" {
				t.Fatalf("historical author lost or resurrected: %v %v", historical, err)
			}
			if err := r.UpsertMachineAgentCandidate(ctx, m.ID, "stale", "codex", "cli", "1", "{}"); err == nil {
				t.Fatal("removed machine accepted stale candidate")
			}
			if err := r.SetMachineAndAgentsOnline(ctx, m.ID); err != nil {
				t.Fatal(err)
			}
			if got, err := r.GetDaemonMachineByID(ctx, m.ID); err != nil || got != nil {
				t.Fatalf("heartbeat resurrected computer: %v %v", got, err)
			}
			var replacement string
			if err = db.QueryRow(`INSERT INTO agents(user_id,name,type,cli_tool) VALUES($1,'Codex','custom','codex') RETURNING id`, u).Scan(&replacement); err != nil {
				t.Fatalf("retired name blocks new Agent: %v", err)
			}
			if _, err = db.Exec(`INSERT INTO conversation_agents(conversation_id,agent_id,added_by,role) VALUES($1,$2,$3,'worker')`, conv, replacement, u); err != nil {
				t.Fatal(err)
			}
			if err = NewConversationRepo(db).UpdateAgentRole(ctx, conv, replacement, "orchestrator"); err != nil {
				t.Fatalf("retired orchestrator blocks replacement: %v", err)
			}
			if got, err := NewConversationRepo(db).GetOrchestrator(ctx, conv); err != nil || got == nil || got.AgentID != replacement {
				t.Fatalf("replacement orchestrator unavailable: %v %v", got, err)
			}
			// 旧任务没有运行时读取接口；直接核对持久历史作为 FK 迁移验收。
			var saved string
			if err = db.Get(&saved, `SELECT result FROM daemon_tasks WHERE agent_id=$1`, a); err != nil || saved != "saved result" {
				t.Fatalf("persistent task history lost: %q %v", saved, err)
			}
			if got, err := r.GetDaemonTask(ctx, pending.ID); err != nil || got.Status != "failed" {
				t.Fatalf("running task not failed: %v %v", got, err)
			}
			if got, err := r.ClaimDaemonTask(ctx, m.ID); err != nil || got != nil {
				t.Fatalf("removed computer can claim: %v %v", got, err)
			}
			if _, err := r.CreateDaemonTask(ctx, u, conv, a, m.ID, "codex", "cli", "test", ""); err == nil {
				t.Fatal("stale dispatch accepted")
			}
			if ok, err := r.CompleteDaemonTask(ctx, pending.ID, m.ID, "stale completion", ""); err != nil || ok {
				t.Fatalf("stale completion accepted: %v %v", ok, err)
			}
			if got, err := NewConversationCheckpointRepo(db).GetByID(ctx, checkpoint); err != nil || got.SourceAgentID != a {
				t.Fatalf("checkpoint lost: %v %v", got, err)
			}
			if got, err := NewConversationForkRepo(db).GetByChild(ctx, child, u); err != nil || got == nil || got.SourceAgentID != a {
				t.Fatalf("fork lost: %v %v", got, err)
			}
			if ok, err := r.DeleteDaemonMachine(ctx, m.ID, u); err != nil || ok {
				t.Fatalf("duplicate removal must be harmless not found: %v %v", ok, err)
			}
		})
	}
}

func TestGlobalDaemonTaskDoesNotRequirePersonalMachine(t *testing.T) {
	db := machineRemovalDB(t)
	var id string
	if err := db.QueryRow(`INSERT INTO agents(name,type,cli_tool,source) VALUES('Legacy Codex','system','codex','daemon') RETURNING id`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	r := NewAgentRepo(db)
	if _, err := r.CreateDaemonTask(context.Background(), uuid.NewString(), "", id, "legacy-global-daemon", "codex", "cli", "test", ""); err != nil {
		t.Fatalf("legacy global daemon unavailable: %v", err)
	}
	if _, err := db.Exec(`UPDATE agents SET retired_at=NOW() WHERE id=$1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := r.CreateDaemonTask(context.Background(), uuid.NewString(), "", id, "legacy-global-daemon", "codex", "cli", "test", ""); err == nil {
		t.Fatal("retired global Agent accepted dispatch")
	}
}

func TestRemoveMachineAlsoRetiresGlobalSystemAgents(t *testing.T) {
	db := machineRemovalDB(t)
	r := NewAgentRepo(db)
	ctx := context.Background()
	u := uuid.NewString()
	if _, err := db.Exec(`INSERT INTO users(id,username,password_hash) VALUES($1,'owner','test')`, u); err != nil {
		t.Fatal(err)
	}
	m, err := r.CreateDaemonMachine(ctx, u, "global-host", "global-test-hash")
	if err != nil {
		t.Fatal(err)
	}
	var id string
	if err = db.QueryRow(`INSERT INTO agents(name,type,cli_tool,source,machine_id) VALUES('Global','system','codex','daemon',$1) RETURNING id`, m.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err = r.CreateDaemonTask(ctx, uuid.NewString(), "", id, m.ID, "codex", "cli", "test", ""); err != nil {
		t.Fatalf("global Agent unavailable before removal: %v", err)
	}
	if ok, err := r.DeleteDaemonMachine(ctx, m.ID, u); err != nil || !ok {
		t.Fatalf("remove global host: %v %v", ok, err)
	}
	if list, err := r.ListAvailable(ctx, ""); err != nil || len(list) != 0 {
		t.Fatalf("global orphan still visible: %v %v", list, err)
	}
	if _, err = r.CreateDaemonTask(ctx, u, "", id, m.ID, "codex", "cli", "test", ""); err == nil {
		t.Fatal("global orphan still executable")
	}
	newMachine, err := r.CreateDaemonMachine(ctx, u, "new-global-host", "new-global-test-hash")
	if err != nil {
		t.Fatal(err)
	}
	if err = r.UpsertSystemAgent(ctx, "New Global", "codex", "1", "[]", newMachine.ID); err != nil {
		t.Fatalf("replacement global registration: %v", err)
	}
	list, err := r.ListAvailable(ctx, "")
	if err != nil || len(list) != 1 || list[0].ID == id || list[0].MachineID == nil || *list[0].MachineID != newMachine.ID {
		t.Fatalf("replacement must be new active identity: %v %v", list, err)
	}
	if old, err := r.GetByID(ctx, id); err != nil || old != nil {
		t.Fatalf("retired global identity revived: %v %v", old, err)
	}
}
