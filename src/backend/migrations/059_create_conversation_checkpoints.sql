-- 将可迁移的会话摘要作为一等资源持久化，原始消息仍是可追溯的事实来源。
CREATE TABLE IF NOT EXISTS conversation_checkpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    source_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    source_session_id TEXT,
    task_id UUID,
    version INTEGER NOT NULL CHECK (version > 0),
    generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
    source_from_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
    source_to_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
    source_message_count INTEGER NOT NULL CHECK (source_message_count > 0),
    summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    markdown TEXT NOT NULL DEFAULT '',
    tokens_before BIGINT NOT NULL DEFAULT 0 CHECK (tokens_before >= 0),
    tokens_after BIGINT NOT NULL DEFAULT 0 CHECK (tokens_after >= 0),
    scope VARCHAR(32) NOT NULL DEFAULT 'conversation_shared'
        CHECK (scope IN ('private_agent', 'task_shared', 'conversation_shared', 'orchestrator_only')),
    status VARCHAR(32) NOT NULL DEFAULT 'generating'
        CHECK (status IN ('generating', 'ready', 'failed_fallback', 'deleted')),
    error_message TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT uq_conversation_checkpoints_version UNIQUE (conversation_id, version)
);

CREATE INDEX IF NOT EXISTS idx_conversation_checkpoints_conversation_created
    ON conversation_checkpoints (conversation_id, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_checkpoints_agent
    ON conversation_checkpoints (source_agent_id, created_at DESC)
    WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_conversation_checkpoints_task
    ON conversation_checkpoints (task_id)
    WHERE task_id IS NOT NULL AND deleted_at IS NULL;

---- DOWN
DROP TABLE IF EXISTS conversation_checkpoints;
