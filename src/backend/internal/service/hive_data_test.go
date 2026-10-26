package service

import (
	"context"
	"errors"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type hiveTestUsers struct{}

func (hiveTestUsers) GetUserByID(_ context.Context, id string) (*model.User, error) {
	if id == "owner" {
		return &model.User{ID: id, IsAdmin: false}, nil
	}
	if id == "admin" {
		return &model.User{ID: id, IsAdmin: true}, nil
	}
	return nil, nil
}

func TestValidateHiveSQL(t *testing.T) {
	table := "charge_dw.dwd_charge_trd_order_di"
	cases := []struct {
		name, sql string
		valid     bool
	}{
		{"aggregate", "SELECT COUNT(*) FROM charge_dw.dwd_charge_trd_order_di WHERE dt = '2026-10-07'", true},
		{"cte", "WITH x AS (SELECT dt, COUNT(*) AS n FROM charge_dw.dwd_charge_trd_order_di WHERE dt = '2026-10-07' GROUP BY dt) SELECT * FROM x", true},
		{"no partition", "SELECT COUNT(*) FROM charge_dw.dwd_charge_trd_order_di", false},
		{"other table", "SELECT * FROM secret.orders WHERE dt = '2026-10-07'", false},
		{"multiple statements", "SELECT * FROM charge_dw.dwd_charge_trd_order_di WHERE dt='2026-10-07'; DROP TABLE secret.orders", false},
		{"insert overwrite", "INSERT OVERWRITE TABLE secret.orders SELECT * FROM charge_dw.dwd_charge_trd_order_di WHERE dt='2026-10-07'", false},
		{"comment", "SELECT * FROM charge_dw.dwd_charge_trd_order_di WHERE dt='2026-10-07' -- hidden", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := validateHiveSQL(table, tc.sql)
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, error=%v", tc.valid, err)
			}
		})
	}
	if err := validateHiveSQL("epower_platform.price_sensitive_v1_3", "SELECT COUNT(*) FROM epower_platform.price_sensitive_v1_3"); err == nil {
		t.Fatal("price-sensitive table must also require a partition")
	}
}

func TestUserAddedHiveSQLRemainsSingleTableAndPartitionBounded(t *testing.T) {
	table := "epower_platform.price_sensitive_v1_2"
	valid := "SELECT dt FROM epower_platform.price_sensitive_v1_2 WHERE dt = '2026-10-07' LIMIT 1"
	if err := validateHiveSQL(table, valid); !errors.Is(err, ErrHiveInvalid) {
		t.Fatalf("unadded table must remain blocked: %v", err)
	}
	if err := validateHiveSQLWithAdded(table, valid, true); err != nil {
		t.Fatalf("added table should pass the existing dt guard: %v", err)
	}
	for _, query := range []string{
		"SELECT * FROM epower_platform.price_sensitive_v1_2 LIMIT 1",
		"SELECT * FROM private.other WHERE dt = '2026-10-07'",
		"SELECT * FROM epower_platform.price_sensitive_v1_2 JOIN private.other ON 1=1 WHERE dt = '2026-10-07'",
		"SELECT * FROM epower_platform.price_sensitive_v1_2 WHERE dt = '2026-10-07'; DROP TABLE private.other",
	} {
		if err := validateHiveSQLWithAdded(table, query, true); !errors.Is(err, ErrHiveInvalid) {
			t.Fatalf("unsafe query must be blocked: %s: %v", query, err)
		}
	}
}

func TestAddHiveTableRejectsUnsafeNameBeforeOpeningConnection(t *testing.T) {
	svc := &HiveDataService{}
	if _, err := svc.AddTable(context.Background(), "owner", "epower_platform.x;DROP TABLE y"); !errors.Is(err, ErrHiveInvalid) {
		t.Fatalf("unsafe table must be rejected: %v", err)
	}
}

func TestHivePersonalAccountBinding(t *testing.T) {
	t.Setenv("DI_AGENT_HIVE_OWNER_USER_ID", "owner")
	svc := &HiveDataService{users: hiveTestUsers{}}
	if err := svc.authorize(context.Background(), "owner"); err != nil {
		t.Fatalf("bound user denied: %v", err)
	}
	if err := svc.authorize(context.Background(), "admin"); !errors.Is(err, ErrReportForbidden) {
		t.Fatalf("another admin must not use personal account: %v", err)
	}
	if err := svc.authorize(context.Background(), "other"); !errors.Is(err, ErrReportForbidden) {
		t.Fatalf("unbound user must not use personal account: %v", err)
	}
}

func TestHiveConnectionRequiresOwnerBinding(t *testing.T) {
	t.Setenv("DI_AGENT_HIVE_HOST", "hive.example.test")
	t.Setenv("DI_AGENT_HIVE_USER", "example")
	t.Setenv("DI_AGENT_HIVE_PASSWORD", "test-only-password")
	t.Setenv("DI_AGENT_HIVE_OWNER_USER_ID", "")
	svc := NewHiveDataService(hiveTestUsers{}, nil)
	if svc.queryDB != nil {
		t.Fatal("personal Hadoop connection must remain disabled without owner binding")
	}
}

func TestHiveStatusForUnboundUserDoesNotExposePersonalAccount(t *testing.T) {
	t.Setenv("DI_AGENT_HIVE_OWNER_USER_ID", "owner")
	svc := &HiveDataService{users: hiveTestUsers{}, account: "personal-hadoop-account"}
	statuses, err := svc.Status(context.Background(), "admin", -1)
	if err != nil {
		t.Fatal(err)
	}
	if statuses[1].Status != "未登录" || statuses[1].Account != "" || statuses[1].SourceCount != 0 {
		t.Fatalf("unbound user must see an unavailable personal connection: %+v", statuses[1])
	}
}

func TestHiveLoginRejectsInvalidInputWithoutReplacingSession(t *testing.T) {
	svc := &HiveDataService{users: hiveTestUsers{}, host: "hive.example.test", port: 8084}
	if err := svc.Login(context.Background(), "owner", "bad account", "password"); !errors.Is(err, ErrHiveInvalid) {
		t.Fatalf("invalid account must be rejected before connection: %v", err)
	}
	if err := svc.Login(context.Background(), "other", "valid_account", "password"); !errors.Is(err, ErrReportForbidden) {
		t.Fatalf("unknown Di Agent user must be denied: %v", err)
	}
	if len(svc.sessions) != 0 {
		t.Fatal("failed logins must not replace or create a Hadoop session")
	}
}

func TestHivePermissionDenialClassification(t *testing.T) {
	if !isHiveSelectDenied(errors.New("user does not have [SELECT] privilege on field")) {
		t.Fatal("Hive SELECT denial must be distinguished from transport errors")
	}
	if isHiveSelectDenied(context.DeadlineExceeded) {
		t.Fatal("timeout must not be presented as no table permission")
	}
}
