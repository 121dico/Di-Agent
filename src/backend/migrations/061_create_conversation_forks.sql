-- Conversation Fork 保存父子分支与检查点分叉点；消息历史不做物理复制。
CREATE TABLE IF NOT EXISTS conversation_forks (
    child_conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    parent_conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
    checkpoint_id UUID NOT NULL REFERENCES conversation_checkpoints(id) ON DELETE RESTRICT,
    forked_from_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE RESTRICT,
    source_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    target_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_conversation_forks_distinct CHECK (child_conversation_id <> parent_conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversation_forks_parent_created
    ON conversation_forks (parent_conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversation_forks_checkpoint
    ON conversation_forks (checkpoint_id);

---- DOWN
DROP TABLE IF EXISTS conversation_forks;
