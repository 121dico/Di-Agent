-- 全局管理权限：最早注册用户作为初始管理员，后续用户默认普通成员。
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE users
SET is_admin = TRUE
WHERE id = (SELECT id FROM users ORDER BY created_at ASC, id ASC LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = TRUE);

---- DOWN
ALTER TABLE users DROP COLUMN IF EXISTS is_admin;
