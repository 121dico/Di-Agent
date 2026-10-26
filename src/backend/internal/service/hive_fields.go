package service

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
)

type hiveFieldScan struct {
	userID string
	db     *sql.DB
	table  string
	cancel context.CancelFunc
	mu     sync.RWMutex
	result model.HiveFieldSnapshot
}

// Fields 只检查已批准或当前账号已添加的表，结果绑定到当前 Hive 连接。
func (s *HiveDataService) Fields(ctx context.Context, userID, rawName string, refresh bool) (*model.HiveFieldSnapshot, error) {
	name := strings.ToLower(strings.TrimSpace(rawName))
	if !validHiveCatalogTable(name) {
		return nil, ErrHiveInvalid
	}
	if err := s.authorize(ctx, userID); err != nil {
		return nil, err
	}
	db, account := s.activeDB(userID)
	if db == nil {
		return nil, ErrHiveUnavailable
	}
	if !approvedHiveTable(name) {
		if s.receipts == nil {
			return nil, ErrHiveTableNotAdded
		}
		added, err := s.receipts.ListAddedTables(ctx, userID, account)
		if err != nil {
			return nil, fmt.Errorf("list Hive tables for field inspection: %w", err)
		}
		allowed := false
		for _, table := range added {
			if table.Name == name {
				allowed = true
				break
			}
		}
		if !allowed {
			return nil, ErrHiveTableNotAdded
		}
	}

	key := userID + "|" + name
	s.fieldsMu.Lock()
	if s.fields == nil {
		s.fields = make(map[string]*hiveFieldScan)
	}
	scan := s.fields[key]
	restart := scan == nil || scan.db != db || (refresh && scan.snapshot().State != "scanning")
	if restart {
		if scan != nil {
			scan.cancel()
		}
		// 一个用户同时只运行一次字段核验，避免反复展开表时挤满连接池。
		for otherKey, other := range s.fields {
			if otherKey != key && other.userID == userID && other.snapshot().State == "scanning" {
				other.cancel()
				delete(s.fields, otherKey)
			}
		}
		scanCtx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		scan = &hiveFieldScan{userID: userID, db: db, table: name, cancel: cancel,
			result: model.HiveFieldSnapshot{TableName: name, State: "scanning", Fields: []model.HiveField{}}}
		s.fields[key] = scan
		go scan.run(scanCtx)
	}
	s.fieldsMu.Unlock()
	return scan.snapshot(), nil
}

func (s *HiveDataService) invalidateHiveFields(userID string) {
	s.fieldsMu.Lock()
	defer s.fieldsMu.Unlock()
	for key, scan := range s.fields {
		if scan.userID == userID {
			scan.cancel()
			delete(s.fields, key)
		}
	}
}

func (s *hiveFieldScan) snapshot() *model.HiveFieldSnapshot {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := s.result
	result.Fields = append([]model.HiveField(nil), s.result.Fields...)
	return &result
}

func (s *hiveFieldScan) run(ctx context.Context) {
	defer s.cancel()
	fields, err := describeHiveFields(ctx, s.db, s.table)
	if err != nil || len(fields) == 0 {
		s.finish("error", "无法读取表字段元数据，请检查连接或元数据权限后重试")
		return
	}
	s.mu.Lock()
	s.result.Fields = fields
	s.result.TotalFields = len(fields)
	s.mu.Unlock()

	// 成功执行零行业务查询可一次确认所有字段；DESCRIBE 本身不代表可读。
	full := fmt.Sprintf("SELECT * FROM %s LIMIT 0", s.table)
	fullErr := probeHiveQuery(ctx, s.db, full)
	if fullErr != nil && !isHiveSelectDenied(fullErr) {
		// 部分分区表强制要求 dt 谓词。
		full = fmt.Sprintf("SELECT * FROM %s WHERE dt = '1970-01-01' LIMIT 0", s.table)
		fullErr = probeHiveQuery(ctx, s.db, full)
	}
	if fullErr == nil {
		s.mu.Lock()
		for i := range s.result.Fields {
			s.result.Fields[i].Access = "readable"
			s.result.Fields[i].PermissionDetail = "已通过当前账号的零行 SELECT 校验"
		}
		s.result.CheckedFields = len(fields)
		s.result.ReadableFields = len(fields)
		s.result.State = "complete"
		s.mu.Unlock()
		return
	} else if !isHiveSelectDenied(fullErr) {
		s.markRemainingUnknown("整表校验暂不可用，无法判断字段权限")
		s.finish("error", "字段权限暂时无法核验，请稍后重试")
		return
	}

	indices := make([]int, 0, len(fields))
	for i, field := range fields {
		if strings.EqualFold(field.Name, "dt") {
			indices = append(indices, i)
		}
	}
	for i, field := range fields {
		if !strings.EqualFold(field.Name, "dt") {
			indices = append(indices, i)
		}
	}
	dtReadable := false
	for _, index := range indices {
		if ctx.Err() != nil {
			s.markRemainingUnknown("核验超时或账号已切换，请重试")
			s.finish("error", "字段核验未完成，请重试")
			return
		}
		access, detail := probeHiveField(ctx, s.db, s.table, fields[index].Name, dtReadable)
		if strings.EqualFold(fields[index].Name, "dt") {
			dtReadable = access == "readable"
		}
		s.mu.Lock()
		s.result.Fields[index].Access = access
		s.result.Fields[index].PermissionDetail = detail
		s.result.CheckedFields++
		switch access {
		case "readable":
			s.result.ReadableFields++
		case "denied":
			s.result.DeniedFields++
		case "unknown":
			s.result.UnknownFields++
		}
		s.mu.Unlock()
	}
	s.finish("complete", "")
}

func (s *hiveFieldScan) markRemainingUnknown(detail string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i := range s.result.Fields {
		if s.result.Fields[i].Access == "checking" {
			s.result.Fields[i].Access = "unknown"
			s.result.Fields[i].PermissionDetail = detail
			s.result.UnknownFields++
			s.result.CheckedFields++
		}
	}
}

func (s *hiveFieldScan) finish(state, detail string) {
	s.mu.Lock()
	s.result.State, s.result.Error = state, detail
	s.mu.Unlock()
}

func describeHiveFields(ctx context.Context, db *sql.DB, table string) ([]model.HiveField, error) {
	queryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	rows, err := db.QueryContext(queryCtx, "DESCRIBE "+table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("read Hive DESCRIBE columns: %w", err)
	}
	if len(columns) < 2 {
		return nil, fmt.Errorf("invalid Hive DESCRIBE result: expected at least two columns")
	}
	fields := make([]model.HiveField, 0)
	seen := make(map[string]int)
	partition := false
	for rows.Next() {
		values := make([]any, len(columns))
		pointers := make([]any, len(columns))
		for i := range values {
			pointers[i] = &values[i]
		}
		if err := rows.Scan(pointers...); err != nil {
			return nil, err
		}
		name := hiveMetadataText(values[0])
		if strings.HasPrefix(strings.ToLower(name), "# partition information") {
			partition = true
		}
		if name == "" || strings.HasPrefix(name, "#") {
			continue
		}
		dataType := hiveMetadataText(values[1])
		if dataType == "" {
			continue
		}
		key := strings.ToLower(name)
		if index, exists := seen[key]; exists {
			fields[index].Partition = fields[index].Partition || partition
			continue
		}
		seen[key] = len(fields)
		field := model.HiveField{Name: name, DataType: dataType, Partition: partition,
			Access: "checking", PermissionDetail: "正在用当前账号核验字段读取权限"}
		if len(values) > 2 {
			field.Description = hiveMetadataText(values[2])
		}
		fields = append(fields, field)
	}
	return fields, rows.Err()
}

func hiveMetadataText(value any) string {
	switch raw := value.(type) {
	case nil:
		return ""
	case []byte:
		return strings.TrimSpace(string(raw))
	default:
		return strings.TrimSpace(fmt.Sprint(raw))
	}
}

func probeHiveField(ctx context.Context, db *sql.DB, table, name string, dtReadable bool) (string, string) {
	if !validHiveCatalogIdentifier(name) {
		return "unknown", "字段名需要特殊引用，未自动核验"
	}
	query := fmt.Sprintf("SELECT `%s` FROM %s LIMIT 0", name, table)
	err := probeHiveQuery(ctx, db, query)
	if err == nil {
		return "readable", "已通过当前账号的零行 SELECT 校验"
	}
	if isHiveSelectDenied(err) {
		return "denied", "当前账号的字段 SELECT 被拒绝"
	}
	partitionQuery := fmt.Sprintf("SELECT `%s` FROM %s WHERE dt = '1970-01-01' LIMIT 0", name, table)
	partitionErr := probeHiveQuery(ctx, db, partitionQuery)
	if partitionErr == nil {
		return "readable", "已通过当前账号的分区零行 SELECT 校验"
	}
	if isHiveSelectDenied(partitionErr) && (dtReadable || strings.EqualFold(name, "dt")) {
		return "denied", "当前账号的字段 SELECT 被拒绝"
	}
	return "unknown", "查询暂不可用，不能据此判断字段权限"
}
