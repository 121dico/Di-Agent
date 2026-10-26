package repository

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/121dico/Di-Agent/src/backend/internal/model"
	"github.com/google/uuid"
)

// GetOrCreateExternalUser 按身份串行开户，用户与映射原子提交，
// 不按本地用户名合并账号，也不自动授予首用户管理员权限。
func (r *UserRepo) GetOrCreateExternalUser(ctx context.Context, provider, subject string) (*model.User, error) {
	if provider == "" || subject == "" {
		return nil, fmt.Errorf("external identity is required")
	}
	tx, err := r.db.BeginTxx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("begin external identity: %w", err)
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, provider+":"+subject); err != nil {
		return nil, fmt.Errorf("lock external identity: %w", err)
	}
	var u model.User
	err = tx.QueryRowxContext(ctx, `SELECT u.id, u.username, u.password_hash, u.avatar, u.is_admin, u.created_at FROM users u JOIN external_identities e ON e.user_id=u.id WHERE e.provider=$1 AND e.subject=$2`, provider, subject).StructScan(&u)
	if errors.Is(err, sql.ErrNoRows) {
		// 冒号隔离本地注册命名空间；无效 bcrypt 标记确保该账号不能密码登录。
		name := "boss:" + uuid.NewString()
		err = tx.QueryRowxContext(ctx, `INSERT INTO users(username,password_hash,is_admin) VALUES($1,'!external-auth-only',FALSE) RETURNING id,username,password_hash,avatar,is_admin,created_at`, name).StructScan(&u)
		if err == nil {
			_, err = tx.ExecContext(ctx, `INSERT INTO external_identities(provider,subject,user_id) VALUES($1,$2,$3)`, provider, subject, u.ID)
		}
	}
	if err != nil {
		return nil, fmt.Errorf("resolve external identity: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return nil, fmt.Errorf("commit external identity: %w", err)
	}
	return &u, nil
}
