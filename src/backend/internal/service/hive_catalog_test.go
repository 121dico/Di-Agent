package service

import (
	"context"
	"errors"
	"testing"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

func TestHiveCatalogIdentifierRejectsUnsafeNames(t *testing.T) {
	for _, name := range []string{"abc", "db_123"} {
		if !validHiveCatalogIdentifier(name) {
			t.Fatalf("valid name rejected: %s", name)
		}
	}
	for _, name := range []string{"db;drop", "a.b", "x y", "", "`name`"} {
		if validHiveCatalogIdentifier(name) {
			t.Fatalf("unsafe name accepted: %s", name)
		}
	}
}

func TestHiveCatalogSortsRecentBeforeAlphabetical(t *testing.T) {
	names := []string{"z.db", "a.db", "m.db"}
	sortHiveCatalogNames(names, []string{"m.db", "z.db"})
	want := []string{"m.db", "z.db", "a.db"}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("got %v, want %v", names, want)
		}
	}
}

func TestHiveCatalogProbeRejectsUnsafeTableBeforeOpeningConnection(t *testing.T) {
	svc := &HiveDataService{}
	_, err := svc.ProbeCatalogTable(context.Background(), "owner", "db.table;DROP TABLE x")
	if !errors.Is(err, ErrHiveInvalid) {
		t.Fatalf("unsafe table should be rejected: %v", err)
	}
}

func TestHiveCatalogExactNameTakesPriorityOverPrefixMatches(t *testing.T) {
	scan := &hiveCatalogScan{result: model.HiveCatalogSnapshot{State: "complete"}, tables: map[string]model.HiveTable{
		"epower_platform.price_sensitive_v1_2":     {Name: "epower_platform.price_sensitive_v1_2"},
		"epower_platform.price_sensitive_v1_2base": {Name: "epower_platform.price_sensitive_v1_2base"},
	}}
	exact := scan.snapshot("epower_platform.price_sensitive_v1_2", nil)
	if len(exact.Tables) != 1 || exact.Tables[0].Name != "epower_platform.price_sensitive_v1_2" {
		t.Fatalf("exact search should show one candidate: %+v", exact.Tables)
	}
	partial := scan.snapshot("epower_platform.price_sensitive_v1", nil)
	if len(partial.Tables) != 2 {
		t.Fatalf("partial search should retain both matches: %+v", partial.Tables)
	}
}
