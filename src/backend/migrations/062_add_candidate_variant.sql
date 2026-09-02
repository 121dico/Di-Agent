-- 底座类型标注：cli（终端命令行，可自动执行）| desktop（桌面端应用，暂不支持自动执行）
ALTER TABLE daemon_agent_candidates
    ADD COLUMN IF NOT EXISTS variant VARCHAR(16) NOT NULL DEFAULT 'cli';

---- DOWN
ALTER TABLE daemon_agent_candidates DROP COLUMN IF EXISTS variant;
