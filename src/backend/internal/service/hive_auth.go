package service

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"
	"time"

	gohive "github.com/beltran/gohive/v2"
)

// hiveSession 保存用户当次登录的连接池；密码仅由驱动在进程内使用。
type hiveSession struct {
	db      *sql.DB
	account string
}

var hiveAccountPattern = regexp.MustCompile(`^[A-Za-z0-9._@-]{1,128}$`)

func (s *HiveDataService) activeDB(userID string) (*sql.DB, string) {
	s.mu.RLock()
	session := s.sessions[userID]
	s.mu.RUnlock()
	if session != nil {
		return session.db, session.account
	}
	if owner := strings.TrimSpace(os.Getenv("DI_AGENT_HIVE_OWNER_USER_ID")); owner != "" && owner == userID {
		return s.queryDB, s.account
	}
	return nil, ""
}

// Login 验证新账号后才替换当前用户的连接，不影响其他用户的会话。
func (s *HiveDataService) Login(ctx context.Context, userID, account, password string) error {
	user, err := s.users.GetUserByID(ctx, userID)
	if err != nil {
		return err
	}
	if user == nil {
		return ErrReportForbidden
	}
	account = strings.TrimSpace(account)
	if !hiveAccountPattern.MatchString(account) || password == "" || len(password) > 1024 {
		return fmt.Errorf("%w: 账号或密码格式不正确", ErrHiveInvalid)
	}
	if s.host == "" || s.port == 0 {
		return ErrHiveUnavailable
	}
	db := gohive.OpenDB(gohive.Config{
		Host: s.host, Port: s.port, Auth: "NONE", Username: account,
		Password: password, Database: "default", TransportMode: "binary",
	})
	db.SetMaxOpenConns(2)
	db.SetMaxIdleConns(0)
	checkCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	err = db.PingContext(checkCtx)
	cancel()
	if err != nil {
		_ = db.Close()
		return ErrHiveLoginFailed
	}
	s.mu.Lock()
	if s.sessions == nil {
		s.sessions = make(map[string]*hiveSession)
	}
	old := s.sessions[userID]
	s.sessions[userID] = &hiveSession{db: db, account: account}
	s.mu.Unlock()
	s.invalidateHiveCatalog(userID)
	s.invalidateHiveFields(userID)
	if old != nil {
		_ = old.db.Close()
	}
	return nil
}

func probeHivePermission(ctx context.Context, db *sql.DB, table string) (string, string) {
	full := fmt.Sprintf("SELECT * FROM %s WHERE dt = '1970-01-01' LIMIT 0", table)
	err := probeHiveQuery(ctx, db, full)
	if err == nil {
		return "有权限", "已验证全部字段的读取权限"
	}
	if !isHiveSelectDenied(err) {
		return "检测失败", "暂时无法验证表权限，请重试"
	}
	partition := fmt.Sprintf("SELECT dt FROM %s WHERE dt = '1970-01-01' LIMIT 0", table)
	err = probeHiveQuery(ctx, db, partition)
	if err == nil {
		return "有权限", "可读取已授权字段；部分字段仍需单独授权"
	}
	if isHiveSelectDenied(err) {
		return "无权限", "当前账号没有可用的表读取权限"
	}
	return "检测失败", "暂时无法验证表权限，请重试"
}

func probeHiveQuery(ctx context.Context, db *sql.DB, query string) error {
	probeCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	rows, err := db.QueryContext(probeCtx, query)
	if err != nil {
		return err
	}
	defer rows.Close()
	_ = rows.Next()
	return rows.Err()
}

func isHiveSelectDenied(err error) bool {
	if err == nil || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "[select] privilege") ||
		strings.Contains(message, "permission denied") ||
		strings.Contains(message, "not authorized") ||
		strings.Contains(message, "access denied")
}
