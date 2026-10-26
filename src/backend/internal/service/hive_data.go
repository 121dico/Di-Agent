package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	gohive "github.com/beltran/gohive/v2"
)

var (
	ErrHiveInvalid         = errors.New("Hive 查询参数无效")
	ErrHiveUnavailable     = errors.New("Hive 连接尚未配置或不可用")
	ErrHiveResultTooLarge  = errors.New("查询结果超过保存上限，请添加聚合或筛选")
	ErrHiveSelectForbidden = errors.New("Hive SELECT 权限不足；请在 SQL 中明确选择已授权的列")
	ErrHiveLoginFailed     = errors.New("Hadoop 登录失败，请检查账号密码和服务状态")
	ErrHiveNotReadable     = errors.New("未能确认当前 Hadoop 账号对该表的读取权限，未添加")
	ErrHiveTableLimit      = errors.New("个人 Hive 表最多添加 50 张")
	ErrHiveTableNotAdded   = errors.New("请先将表添加到我的 Hive 表")
	hiveSourcePattern      = regexp.MustCompile(`(?i)\b(?:from|join)\s+([a-z_][a-z0-9_.]*)`)
	hiveCTEPattern         = regexp.MustCompile(`(?i)(?:\bwith|,)\s*([a-z_][a-z0-9_]*)\s+as\s*\(`)
	hiveForbiddenPattern   = regexp.MustCompile(`(?i)\b(insert|overwrite|update|delete|merge|drop|alter|create|truncate|grant|revoke|load|export|import|add|set|use|dfs|msck|repair|cache|uncache|analyze|execute|call)\b`)
	hivePartitionPattern   = regexp.MustCompile(`(?i)\bdt\s*(=|in\s*\(|between\b|>=|<=)`)
)

var approvedHiveTables = []model.HiveTable{
	{Name: "epower_platform.price_sensitive_v1_3", Description: "价敏数据；查询需指定 dt 分区"},
	{Name: "charge_dw.dwd_charge_trd_order_di", Description: "充电交易订单；部分列需单独授权，查询需指定 dt 分区"},
}

type HiveReceiptStore interface {
	Create(context.Context, *model.HiveQueryReceipt) error
	List(context.Context, string) ([]model.HiveQueryReceipt, error)
	Get(context.Context, string, string) (*model.HiveQueryReceipt, error)
	ListAddedTables(context.Context, string, string) ([]model.HiveSavedTable, error)
	AddTable(context.Context, string, string, string, bool) error
}

type HiveDataService struct {
	users     ReportUserStore
	receipts  HiveReceiptStore
	queryDB   *sql.DB
	account   string
	host      string
	port      int
	mu        sync.RWMutex
	sessions  map[string]*hiveSession
	catalogMu sync.Mutex
	catalogs  map[string]*hiveCatalogScan
	fieldsMu  sync.Mutex
	fields    map[string]*hiveFieldScan
}

func NewHiveDataService(users ReportUserStore, receipts HiveReceiptStore) *HiveDataService {
	host := strings.TrimSpace(os.Getenv("DI_AGENT_HIVE_HOST"))
	account := strings.TrimSpace(os.Getenv("DI_AGENT_HIVE_USER"))
	password := os.Getenv("DI_AGENT_HIVE_PASSWORD")
	ownerID := strings.TrimSpace(os.Getenv("DI_AGENT_HIVE_OWNER_USER_ID"))
	s := &HiveDataService{users: users, receipts: receipts, account: account,
		host: host, port: 8084, sessions: make(map[string]*hiveSession)}
	if host == "" {
		return s
	}
	port := 8084
	if raw := os.Getenv("DI_AGENT_HIVE_PORT"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 65535 {
			return s
		}
		port = parsed
	}
	s.port = port
	if account == "" || password == "" || ownerID == "" {
		return s
	}
	s.queryDB = gohive.OpenDB(gohive.Config{
		Host: host, Port: port, Auth: "NONE", Username: account,
		Password: password, Database: "default", TransportMode: "binary",
	})
	s.queryDB.SetMaxOpenConns(2)
	s.queryDB.SetMaxIdleConns(0)
	return s
}

func (s *HiveDataService) Close() error {
	s.fieldsMu.Lock()
	for _, scan := range s.fields {
		scan.cancel()
	}
	s.fields = nil
	s.fieldsMu.Unlock()
	s.catalogMu.Lock()
	for _, catalog := range s.catalogs {
		catalog.cancel()
	}
	s.catalogs = nil
	s.catalogMu.Unlock()
	s.mu.Lock()
	sessions := s.sessions
	s.sessions = nil
	s.mu.Unlock()
	for _, session := range sessions {
		_ = session.db.Close()
	}
	if s.queryDB != nil {
		return s.queryDB.Close()
	}
	return nil
}

func (s *HiveDataService) authorize(ctx context.Context, userID string) error {
	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if user == nil {
		return ErrReportForbidden
	}
	// 手动登录只属于当前 Di Agent 用户，不共享服务端的默认个人账号。
	s.mu.RLock()
	_, loggedIn := s.sessions[userID]
	s.mu.RUnlock()
	if loggedIn {
		return nil
	}
	// 个人 Hadoop 账号只可供明确绑定的 Di Agent 用户使用。
	if owner := strings.TrimSpace(os.Getenv("DI_AGENT_HIVE_OWNER_USER_ID")); owner != "" {
		if owner == userID {
			return nil
		}
		return ErrReportForbidden
	}
	if !user.IsAdmin {
		return ErrReportForbidden
	}
	return nil
}

func (s *HiveDataService) Tables(ctx context.Context, userID string) ([]model.HiveTable, error) {
	if err := s.authorize(ctx, userID); err != nil {
		return nil, err
	}
	db, account := s.activeDB(userID)
	if db == nil {
		return nil, ErrHiveUnavailable
	}
	rows := make([]model.HiveTable, 0, len(approvedHiveTables))
	for _, table := range approvedHiveTables {
		table.Permission, table.PermissionDetail = probeHivePermission(ctx, db, table.Name)
		table.QueryEnabled = table.Permission == "有权限"
		rows = append(rows, table)
	}
	if s.receipts != nil {
		added, err := s.receipts.ListAddedTables(ctx, userID, account)
		if err != nil {
			return nil, err
		}
		for _, table := range added {
			if approvedHiveTable(table.Name) {
				continue
			}
			row := model.HiveTable{Name: table.Name, Description: "用户自行添加的 Hive 表",
				Permission: "已添加", PermissionDetail: "添加时已通过读取验证；运行查询时 Hive 会重新鉴权",
				QueryEnabled: table.DTQueryable}
			if !table.DTQueryable {
				row.PermissionDetail = "已验证表可读；当前 SQL 查询仅支持可读取 dt 字段的表"
			}
			rows = append(rows, row)
		}
	}
	return rows, nil
}

// AddTable only saves a table after the current Hadoop session proves SELECT
// access. A readable table without a usable dt column remains catalog-only.
func (s *HiveDataService) AddTable(ctx context.Context, userID, rawName string) (*model.HiveTable, error) {
	name := strings.ToLower(strings.TrimSpace(rawName))
	if !validHiveCatalogTable(name) {
		return nil, ErrHiveInvalid
	}
	if err := s.authorize(ctx, userID); err != nil {
		return nil, err
	}
	db, account := s.activeDB(userID)
	if db == nil || account == "" || s.receipts == nil {
		return nil, ErrHiveUnavailable
	}
	permission, detail := probeCatalogTable(ctx, db, name)
	if permission != "有权限" {
		return nil, ErrHiveNotReadable
	}
	added, err := s.receipts.ListAddedTables(ctx, userID, account)
	if err != nil {
		return nil, err
	}
	found := false
	for _, table := range added {
		if table.Name == name {
			found = true
			break
		}
	}
	if len(added) >= 50 && !found {
		return nil, ErrHiveTableLimit
	}
	dtQueryable := probeHiveQuery(ctx, db, fmt.Sprintf("SELECT dt FROM %s WHERE dt = '1970-01-01' LIMIT 0", name)) == nil
	if err := s.receipts.AddTable(ctx, userID, account, name, dtQueryable); err != nil {
		return nil, err
	}
	if !dtQueryable {
		detail += "；已添加到目录，当前 SQL 查询仅支持 dt 字段可读的表"
	}
	return &model.HiveTable{Name: name, Description: "用户自行添加的 Hive 表", Permission: "有权限",
		PermissionDetail: detail, QueryEnabled: dtQueryable}, nil
}

func (s *HiveDataService) Status(ctx context.Context, userID string, apiCount int) ([]model.HiveConnectionStatus, error) {
	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user == nil {
		return nil, ErrReportForbidden
	}
	db, hiveAccount := s.activeDB(userID)
	hiveStatus, hiveDetail, hiveTableCount := "未登录", "请输入自己的 Hadoop 账号密码并连接", 0
	if owner := strings.TrimSpace(os.Getenv("DI_AGENT_HIVE_OWNER_USER_ID")); owner == userID && db == nil {
		hiveStatus, hiveDetail = "未配置", "等待服务端配置 Hadoop 账号，或在此登录自己的账号"
	}
	if db != nil {
		hiveTableCount = len(approvedHiveTables)
		checkCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
		err = db.PingContext(checkCtx)
		cancel()
		if err == nil {
			hiveStatus, hiveDetail = "已连接", "HiveServer2 账号验证成功；表权限以右侧实时检测结果为准"
		} else {
			hiveStatus, hiveDetail = "连接失败", "HiveServer2 无法建立会话"
		}
	}
	apiStatus := "未配置"
	apiDetail := "没有已登记的 API 数据源"
	if apiCount < 0 {
		apiStatus, apiDetail = "需管理员权限", "API 数据源由 Di Agent 管理员维护"
		apiCount = 0
	} else if apiCount > 0 {
		apiStatus, apiDetail = "已登记", "逐条查看凭据状态；接口连通性在查询时验证"
	}
	return []model.HiveConnectionStatus{
		{Kind: "api", Name: "API 接口", Account: "各数据源独立凭据", Status: apiStatus, Detail: apiDetail, SourceCount: apiCount},
		{Kind: "hive", Name: "Hadoop / Hive", Account: hiveAccount, Status: hiveStatus, Detail: hiveDetail, SourceCount: hiveTableCount},
		{Kind: "datamap", Name: "数据地图", Account: "", Status: "未接入", Detail: "尚未配置独立的服务端认证与接口"},
		{Kind: "cooper", Name: "Cooper", Account: "", Status: "未接入", Detail: "尚未配置独立的服务端认证与接口"},
	}, nil
}

// stripHiveLiterals 拒绝注释和多语句，并移除字面量以供只读语法检查。
func stripHiveLiterals(query string) (string, error) {
	var out strings.Builder
	quote := byte(0)
	for i := 0; i < len(query); i++ {
		ch := query[i]
		if quote != 0 {
			if ch == '\\' && i+1 < len(query) {
				i++
				out.WriteString("  ")
				continue
			}
			if ch == quote {
				if i+1 < len(query) && query[i+1] == quote {
					i++
					out.WriteString("  ")
					continue
				}
				quote = 0
			}
			out.WriteByte(' ')
			continue
		}
		if ch == '\'' || ch == '"' || ch == '`' {
			quote = ch
			out.WriteByte(' ')
			continue
		}
		if ch == ';' || (ch == '-' && i+1 < len(query) && query[i+1] == '-') ||
			(ch == '/' && i+1 < len(query) && query[i+1] == '*') || ch == '#' {
			return "", ErrHiveInvalid
		}
		out.WriteByte(ch)
	}
	if quote != 0 {
		return "", ErrHiveInvalid
	}
	return out.String(), nil
}

func validateHiveSQL(table, query string) error {
	return validateHiveSQLWithAdded(table, query, false)
}

func validateHiveSQLWithAdded(table, query string, added bool) error {
	if len(query) == 0 || len(query) > 20000 {
		return ErrHiveInvalid
	}
	approved := added && validHiveCatalogTable(table)
	for _, item := range approvedHiveTables {
		if item.Name == table {
			approved = true
			break
		}
	}
	if !approved {
		return ErrHiveInvalid
	}
	clean, err := stripHiveLiterals(query)
	if err != nil {
		return err
	}
	trimmed := strings.TrimSpace(clean)
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "SELECT ") && !strings.HasPrefix(upper, "WITH ") {
		return ErrHiveInvalid
	}
	if hiveForbiddenPattern.MatchString(clean) {
		return ErrHiveInvalid
	}
	refs := hiveSourcePattern.FindAllStringSubmatch(clean, -1)
	if len(refs) == 0 {
		return ErrHiveInvalid
	}
	cteNames := make(map[string]bool)
	for _, match := range hiveCTEPattern.FindAllStringSubmatch(clean, -1) {
		cteNames[strings.ToLower(match[1])] = true
	}
	containsChosen := false
	for _, ref := range refs {
		name := strings.ToLower(ref[1])
		if name == strings.ToLower(table) {
			containsChosen = true
			continue
		}
		if cteNames[name] {
			continue
		}
		// 仅允许另外一张已批准的 Hive 表参与 JOIN。
		valid := false
		for _, item := range approvedHiveTables {
			if name == item.Name {
				valid = true
				break
			}
		}
		if !valid {
			return ErrHiveInvalid
		}
	}
	if !containsChosen {
		return ErrHiveInvalid
	}
	if !hivePartitionPattern.MatchString(clean) {
		return fmt.Errorf("%w: 查询必须包含 dt 分区条件", ErrHiveInvalid)
	}
	return nil
}

func (s *HiveDataService) Query(ctx context.Context, userID string, input model.HiveQueryRequest) (*model.HiveQueryReceipt, error) {
	if err := s.authorize(ctx, userID); err != nil {
		return nil, err
	}
	db, account := s.activeDB(userID)
	if db == nil {
		return nil, ErrHiveUnavailable
	}
	input.SQL = strings.TrimSpace(input.SQL)
	input.SQL = strings.TrimSpace(strings.TrimSuffix(input.SQL, ";"))
	added := false
	if !approvedHiveTable(input.TableName) && s.receipts != nil && validHiveCatalogTable(input.TableName) {
		tables, err := s.receipts.ListAddedTables(ctx, userID, account)
		if err != nil {
			return nil, err
		}
		for _, table := range tables {
			if table.Name == input.TableName && table.DTQueryable {
				added = true
				break
			}
		}
	}
	if err := validateHiveSQLWithAdded(input.TableName, input.SQL, added); err != nil {
		return nil, err
	}
	queryCtx, cancel := context.WithTimeout(ctx, 3*time.Minute)
	defer cancel()
	started := time.Now()
	rows, err := db.QueryContext(queryCtx, input.SQL)
	if err != nil {
		if strings.Contains(err.Error(), "does not have [SELECT] privilege") {
			return nil, ErrHiveSelectForbidden
		}
		return nil, fmt.Errorf("hive query: %w", err)
	}
	defer rows.Close()
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := make([]map[string]any, 0)
	resultBytes := 2 // JSON 数组括号。
	for rows.Next() {
		if len(result) >= 10000 {
			return nil, ErrHiveResultTooLarge
		}
		values := make([]any, len(columns))
		dest := make([]any, len(columns))
		for i := range values {
			dest[i] = &values[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, err
		}
		row := make(map[string]any, len(columns))
		for i, col := range columns {
			if raw, ok := values[i].([]byte); ok {
				row[col] = string(raw)
			} else {
				row[col] = values[i]
			}
		}
		encodedRow, err := json.Marshal(row)
		if err != nil {
			return nil, err
		}
		resultBytes += len(encodedRow) + 1
		if resultBytes > 8*1024*1024 {
			return nil, ErrHiveResultTooLarge
		}
		result = append(result, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if len(encoded) > 8*1024*1024 {
		return nil, ErrHiveResultTooLarge
	}
	receipt := &model.HiveQueryReceipt{OwnerUserID: userID, TableName: input.TableName,
		SQL: input.SQL, RowsJSON: encoded, RowCount: len(result), DurationMS: time.Since(started).Milliseconds()}
	if err := s.receipts.Create(ctx, receipt); err != nil {
		return nil, err
	}
	return receipt, nil
}

// Probe executes one fixed, bounded SELECT with the requester's own Hive session.
// Success proves only dt-column readability and whether that partition has a row.
func (s *HiveDataService) Probe(ctx context.Context, userID string, input model.HiveProbeRequest) (*model.HiveProbeResult, error) {
	if err := s.authorize(ctx, userID); err != nil {
		return nil, err
	}
	approved := false
	for _, table := range approvedHiveTables {
		if input.TableName == table.Name {
			approved = true
			break
		}
	}
	parsedDate, err := time.Parse("2006-01-02", input.DT)
	if !approved || err != nil || parsedDate.Format("2006-01-02") != input.DT {
		return nil, ErrHiveInvalid
	}
	queryCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	query := fmt.Sprintf("SELECT dt FROM %s WHERE dt = '%s' LIMIT 1", input.TableName, input.DT)
	receipt, err := s.Query(queryCtx, userID, model.HiveQueryRequest{TableName: input.TableName, SQL: query})
	if err != nil {
		return nil, err
	}
	return &model.HiveProbeResult{
		TableName: input.TableName, DT: input.DT, Readable: true,
		RowFound: receipt.RowCount > 0, Scope: "dt_column_in_requested_partition_only",
	}, nil
}

func (s *HiveDataService) List(ctx context.Context, userID string) ([]model.HiveQueryReceipt, error) {
	if err := s.authorize(ctx, userID); err != nil {
		return nil, err
	}
	return s.receipts.List(ctx, userID)
}

func (s *HiveDataService) Get(ctx context.Context, userID, id string) (*model.HiveQueryReceipt, error) {
	if err := s.authorize(ctx, userID); err != nil {
		return nil, err
	}
	return s.receipts.Get(ctx, userID, id)
}
