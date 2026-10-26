package service

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

// Metadata visibility is not SELECT permission. Each table is independently
// checked with the requesting user's own Hive connection in the background.
type hiveCatalogScan struct {
	db     *sql.DB
	search string
	cancel context.CancelFunc
	mu     sync.RWMutex
	result model.HiveCatalogSnapshot
	tables map[string]model.HiveTable
}

var hiveCatalogIdentifier = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

func validHiveCatalogIdentifier(value string) bool { return hiveCatalogIdentifier.MatchString(value) }

func validHiveCatalogTable(value string) bool {
	parts := strings.Split(value, ".")
	return len(parts) == 2 && validHiveCatalogIdentifier(parts[0]) && validHiveCatalogIdentifier(parts[1])
}

func sortHiveCatalogNames(names, recent []string) {
	positions := make(map[string]int, len(recent))
	for i, name := range recent {
		if _, exists := positions[name]; !exists {
			positions[name] = i
		}
	}
	sort.Slice(names, func(i, j int) bool {
		left, leftRecent := positions[names[i]]
		right, rightRecent := positions[names[j]]
		if leftRecent && rightRecent {
			return left < right
		}
		if leftRecent {
			return true
		}
		if rightRecent {
			return false
		}
		return names[i] < names[j]
	})
}

// Catalog returns an immediate snapshot and starts one bounded background scan
// per user/Hadoop session. A user never sees another user's cached metadata.
func (s *HiveDataService) Catalog(ctx context.Context, userID, search string, recent []string) (*model.HiveCatalogSnapshot, error) {
	if err := s.authorize(ctx, userID); err != nil {
		return nil, err
	}
	db, _ := s.activeDB(userID)
	if db == nil {
		return nil, ErrHiveUnavailable
	}
	search = strings.ToLower(strings.TrimSpace(search))
	if len(search) > 100 {
		return nil, ErrHiveInvalid
	}
	if len(recent) > 20 {
		recent = recent[:20]
	}
	s.catalogMu.Lock()
	if s.catalogs == nil {
		s.catalogs = make(map[string]*hiveCatalogScan)
	}
	scan := s.catalogs[userID]
	failed := false
	missingRecent := false
	if scan != nil {
		scan.mu.RLock()
		failed = scan.result.State == "error"
		if search == "" && scan.result.State == "complete" {
			for _, name := range recent {
				if validHiveCatalogTable(name) {
					if _, exists := scan.tables[name]; !exists {
						missingRecent = true
						break
					}
				}
			}
		}
		scan.mu.RUnlock()
	}
	if scan == nil || scan.db != db || scan.search != search || failed || missingRecent {
		if scan != nil {
			scan.cancel()
		}
		scanCtx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		scan = &hiveCatalogScan{db: db, search: search, cancel: cancel, tables: make(map[string]model.HiveTable),
			result: model.HiveCatalogSnapshot{State: "scanning", Tables: []model.HiveTable{}}}
		s.catalogs[userID] = scan
		go scanHiveCatalog(scanCtx, scan, search, recent)
	}
	s.catalogMu.Unlock()
	return scan.snapshot(search, recent), nil
}

func (s *HiveDataService) invalidateHiveCatalog(userID string) {
	s.catalogMu.Lock()
	if scan := s.catalogs[userID]; scan != nil {
		scan.cancel()
		delete(s.catalogs, userID)
	}
	s.catalogMu.Unlock()
}

// ProbeCatalogTable verifies one named table without running a data scan.
// It does not widen the existing SQL query allowlist.
func (s *HiveDataService) ProbeCatalogTable(ctx context.Context, userID, name string) (*model.HiveTable, error) {
	if !validHiveCatalogTable(name) {
		return nil, ErrHiveInvalid
	}
	if err := s.authorize(ctx, userID); err != nil {
		return nil, err
	}
	db, _ := s.activeDB(userID)
	if db == nil {
		return nil, ErrHiveUnavailable
	}
	permission, detail := probeCatalogTable(ctx, db, name)
	row := model.HiveTable{Name: name, Description: "当前账号对指定表的读取检查", Permission: permission, PermissionDetail: detail, QueryEnabled: approvedHiveTable(name)}
	s.catalogMu.Lock()
	scan := s.catalogs[userID]
	s.catalogMu.Unlock()
	if scan != nil && scan.db == db {
		scan.updatePermission(name, permission, detail)
	}
	return &row, nil
}

func (s *hiveCatalogScan) snapshot(search string, recent []string) *model.HiveCatalogSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := s.result
	result.Tables = make([]model.HiveTable, 0, 100)
	names := make([]string, 0, len(s.tables))
	search = strings.ToLower(strings.TrimSpace(search))
	for name := range s.tables {
		if search == "" || strings.Contains(strings.ToLower(name), search) {
			names = append(names, name)
		}
	}
	// A fully qualified name that exists should not be mixed with longer names
	// sharing its prefix. Partial database.table searches still return matches.
	if validHiveCatalogTable(search) {
		if _, exact := s.tables[search]; exact {
			names = []string{search}
			result.DiscoveredTables = 1
			result.HasMore = false
		}
	}
	sortHiveCatalogNames(names, recent)
	result.HasMore = result.HasMore || len(names) > 100
	for _, name := range names {
		if len(result.Tables) == 100 {
			break
		}
		result.Tables = append(result.Tables, s.tables[name])
	}
	return &result
}

func scanHiveCatalog(ctx context.Context, scan *hiveCatalogScan, search string, recent []string) {
	defer scan.cancel()
	databases, err := listHiveCatalogNames(ctx, scan.db, "SHOW DATABASES")
	if err != nil {
		scan.finish("error", "无法读取 Hive 库目录，请检查当前账号的元数据权限和连接状态")
		return
	}
	scan.mu.Lock()
	scan.result.DatabaseCount = len(databases)
	scan.mu.Unlock()
	// An account may see thousands of database names. Metadata visibility is
	// not a grant. Search only matching databases; permission is checked only
	// when the user explicitly adds one candidate.
	selected := make([]string, 0, 3)
	if search != "" {
		if dot := strings.IndexByte(search, '.'); dot >= 0 {
			if validHiveCatalogIdentifier(search[:dot]) {
				selected = append(selected, search[:dot])
			}
		} else {
			for _, database := range databases {
				if validHiveCatalogIdentifier(database) && strings.Contains(strings.ToLower(database), search) {
					selected = append(selected, database)
				}
			}
			sort.Strings(selected)
			if len(selected) > 3 {
				scan.mu.Lock()
				scan.result.Notice = "匹配的库较多，仅检查前 3 个；请输入更精确的库名"
				scan.mu.Unlock()
				selected = selected[:3]
			}
		}
	}
	if search == "" {
		for _, name := range recent {
			if validHiveCatalogTable(name) {
				scan.add(name)
			}
		}
	}
	for _, database := range selected {
		if err := ctx.Err(); err != nil {
			scan.finish("error", "检查超时，已保留当前结果")
			return
		}
		tables, err := listHiveCatalogNames(ctx, scan.db, "SHOW TABLES IN "+database)
		if err != nil {
			scan.mu.Lock()
			scan.result.ScannedDatabases++
			scan.result.FailedDatabases++
			scan.mu.Unlock()
			continue
		}
		matched := 0
		for _, table := range tables {
			if !validHiveCatalogIdentifier(table) {
				continue
			}
			name := database + "." + table
			if !strings.Contains(strings.ToLower(name), search) {
				continue
			}
			matched++
			if matched <= 100 {
				scan.add(name)
			}
		}
		scan.mu.Lock()
		scan.result.ScannedDatabases++
		if matched > 100 {
			scan.result.HasMore = true
			scan.result.Notice = "结果较多，仅展示前 100 张；缩小搜索范围可继续查找"
		}
		scan.mu.Unlock()
	}
	scan.finish("complete", "")
}

func (s *hiveCatalogScan) add(name string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.tables[name]; exists {
		return
	}
	s.tables[name] = model.HiveTable{Name: name, Description: "账号发现或最近访问的 Hive 表", Permission: "待核实", PermissionDetail: "待验证读取权限；点击此表可单独核验", QueryEnabled: approvedHiveTable(name)}
	s.result.DiscoveredTables++
}

func (s *hiveCatalogScan) updatePermission(name, permission, detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	row, exists := s.tables[name]
	if !exists {
		return
	}
	if row.Permission == "待核实" {
		s.result.CheckedTables++
	}
	if row.Permission != "有权限" && permission == "有权限" {
		s.result.ReadableTables++
	}
	if row.Permission == "有权限" && permission != "有权限" {
		s.result.ReadableTables--
	}
	row.Permission, row.PermissionDetail = permission, detail
	s.tables[name] = row
}

func (s *hiveCatalogScan) finish(state, message string) {
	s.mu.Lock()
	s.result.State, s.result.Error = state, message
	s.mu.Unlock()
}

func listHiveCatalogNames(ctx context.Context, db *sql.DB, query string) ([]string, error) {
	queryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	rows, err := db.QueryContext(queryCtx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	if len(columns) == 0 {
		return nil, fmt.Errorf("empty Hive metadata result")
	}
	names := make([]string, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		if values[0] == nil {
			continue
		}
		name := ""
		switch value := values[0].(type) {
		case []byte:
			name = strings.TrimSpace(string(value))
		default:
			name = strings.TrimSpace(fmt.Sprint(value))
		}
		if name != "" {
			names = append(names, name)
		}
	}
	return names, rows.Err()
}

func approvedHiveTable(name string) bool {
	for _, table := range approvedHiveTables {
		if table.Name == name {
			return true
		}
	}
	return false
}

func probeCatalogTable(ctx context.Context, db *sql.DB, name string) (string, string) {
	if approvedHiveTable(name) {
		return probeHivePermission(ctx, db, name)
	}
	err := probeHiveQuery(ctx, db, "SELECT * FROM "+name+" LIMIT 0")
	if err == nil {
		return "有权限", "已验证全部字段的读取权限"
	}
	if !isHiveSelectDenied(err) {
		// Some Hive installations require a partition predicate even for LIMIT 0.
		partitionErr := probeHiveQuery(ctx, db, "SELECT * FROM "+name+" WHERE dt = '1970-01-01' LIMIT 0")
		if partitionErr == nil {
			return "有权限", "已验证全部字段的读取权限"
		}
		if isHiveSelectDenied(partitionErr) {
			err = partitionErr
		}
	}
	if !isHiveSelectDenied(err) {
		return "检测失败", "读取验证暂时失败，可稍后重试"
	}
	// Partitioned tables may grant only a subset of columns. A successful dt
	// probe proves some read access without claiming every field is authorized.
	if err := probeHiveQuery(ctx, db, "SELECT dt FROM "+name+" LIMIT 0"); err == nil {
		return "有权限", "已验证 dt 字段可读；其他字段可能需要单独授权"
	}
	return "待核实", "全部字段读取被拒；仍可能有部分字段权限"
}
