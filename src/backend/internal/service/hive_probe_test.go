package service

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type probeTestDriver struct{ queries *[]string }

func (d probeTestDriver) Open(string) (driver.Conn, error) { return probeTestConn{d.queries}, nil }

type probeTestConnector struct{ queries *[]string }

func (c probeTestConnector) Connect(context.Context) (driver.Conn, error) {
	return probeTestConn{c.queries}, nil
}
func (c probeTestConnector) Driver() driver.Driver { return probeTestDriver{c.queries} }

type probeTestConn struct{ queries *[]string }

func (c probeTestConn) Prepare(string) (driver.Stmt, error) {
	return nil, errors.New("unexpected prepare")
}
func (c probeTestConn) Close() error              { return nil }
func (c probeTestConn) Begin() (driver.Tx, error) { return nil, errors.New("unexpected transaction") }
func (c probeTestConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	*c.queries = append(*c.queries, query)
	return &probeTestRows{}, nil
}

type probeTestRows struct{ sent bool }

func (*probeTestRows) Columns() []string { return []string{"dt"} }
func (*probeTestRows) Close() error      { return nil }
func (r *probeTestRows) Next(dest []driver.Value) error {
	if r.sent {
		return io.EOF
	}
	r.sent = true
	dest[0] = "2026-10-07"
	return nil
}

type probeTestReceipts struct{ saved *model.HiveQueryReceipt }

func (r *probeTestReceipts) Create(_ context.Context, row *model.HiveQueryReceipt) error {
	r.saved = row
	return nil
}
func (*probeTestReceipts) List(context.Context, string) ([]model.HiveQueryReceipt, error) {
	return nil, nil
}
func (*probeTestReceipts) Get(context.Context, string, string) (*model.HiveQueryReceipt, error) {
	return nil, nil
}

func (*probeTestReceipts) ListAddedTables(context.Context, string, string) ([]model.HiveSavedTable, error) {
	return nil, nil
}

func (*probeTestReceipts) AddTable(context.Context, string, string, string, bool) error {
	return errors.New("probe must not add a Hive table")
}

func TestOwnerCanProbeOnlyApprovedHiveDateColumn(t *testing.T) {
	t.Setenv("DI_AGENT_HIVE_OWNER_USER_ID", "owner")
	queries := []string{}
	db := sql.OpenDB(probeTestConnector{queries: &queries})
	defer db.Close()
	receipts := &probeTestReceipts{}
	svc := &HiveDataService{users: hiveTestUsers{}, receipts: receipts, queryDB: db}
	result, err := svc.Probe(context.Background(), "owner", model.HiveProbeRequest{
		TableName: "epower_platform.price_sensitive_v1_3", DT: "2026-10-07",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Readable || !result.RowFound || result.TableName != "epower_platform.price_sensitive_v1_3" || result.DT != "2026-10-07" {
		t.Fatalf("unexpected probe result: %+v", result)
	}
	if len(queries) != 1 || queries[0] != "SELECT dt FROM epower_platform.price_sensitive_v1_3 WHERE dt = '2026-10-07' LIMIT 1" {
		t.Fatalf("probe must run one fixed bounded read-only query: %v", queries)
	}
	if receipts.saved == nil || receipts.saved.RowCount != 1 || !json.Valid(receipts.saved.RowsJSON) {
		t.Fatalf("expected one persisted query proof: %+v", receipts.saved)
	}
	if strings.Contains(string(receipts.saved.RowsJSON), "duid") {
		t.Fatal("probe must not read other columns")
	}
}

func TestHiveProbeRejectsOtherUserAndUnknownTableBeforeQuery(t *testing.T) {
	t.Setenv("DI_AGENT_HIVE_OWNER_USER_ID", "owner")
	svc := &HiveDataService{users: hiveTestUsers{}}
	_, err := svc.Probe(context.Background(), "admin", model.HiveProbeRequest{TableName: "epower_platform.price_sensitive_v1_3", DT: "2026-10-07"})
	if !errors.Is(err, ErrReportForbidden) {
		t.Fatalf("other Di Agent user must not borrow personal Hadoop credentials: %v", err)
	}
	for _, request := range []model.HiveProbeRequest{
		{TableName: "secret.orders", DT: "2026-10-07"},
		{TableName: "epower_platform.price_sensitive_v1_3", DT: "2026-10-07' OR 1=1 --"},
	} {
		_, err = svc.Probe(context.Background(), "owner", request)
		if !errors.Is(err, ErrHiveInvalid) {
			t.Fatalf("invalid probe must be rejected: %+v err=%v", request, err)
		}
	}
}
