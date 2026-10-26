-- 移除电脑只退役 Agent，保留检查点、分叉与消息引用。
BEGIN;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;
-- 同名 Agent 可来自多台电脑；退役并解绑后不得与活跃自建 Agent 冲突。
DROP INDEX IF EXISTS idx_agents_user_name;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_user_name ON agents (user_id, name)
    WHERE user_id IS NOT NULL AND machine_id IS NULL AND retired_at IS NULL;
-- 全局 CLI 的旧身份仍留作历史，新电脑注册必须能够创建新的活跃身份。
DROP INDEX IF EXISTS idx_agents_system_cli;
CREATE UNIQUE INDEX IF NOT EXISTS idx_agents_system_cli ON agents (cli_tool)
    WHERE user_id IS NULL AND retired_at IS NULL;
-- 旧版持久任务仍是历史记录；移除电脑不能级联销毁已完成任务。
ALTER TABLE daemon_tasks ALTER COLUMN machine_id DROP NOT NULL;
ALTER TABLE daemon_tasks DROP CONSTRAINT IF EXISTS daemon_tasks_machine_id_fkey;
ALTER TABLE daemon_tasks ADD CONSTRAINT daemon_tasks_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES daemon_machines(id) ON DELETE SET NULL;
COMMIT;

---- DOWN
-- 退役记录可能重名，保留 retired_at 列与历史数据；不提供破坏性自动回滚。
-- 旧二进制的全局 Agent ON CONFLICT 依赖旧系统索引。仅在确认 user_id IS NULL
-- 的 cli_tool 没有重复值后，才可把 idx_agents_system_cli 恢复为 WHERE user_id IS NULL。
-- 已产生同 CLI 新旧身份时不能直接回滚该路径，更不能通过删除历史强行恢复索引。
