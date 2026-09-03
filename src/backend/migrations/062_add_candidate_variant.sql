-- 底座运行时标注：cli（独立命令行）| desktop（桌面应用内置运行时）
ALTER TABLE daemon_agent_candidates
    ADD COLUMN IF NOT EXISTS variant VARCHAR(16) NOT NULL DEFAULT 'cli';

---- DOWN
ALTER TABLE daemon_agent_candidates DROP COLUMN IF EXISTS variant;
