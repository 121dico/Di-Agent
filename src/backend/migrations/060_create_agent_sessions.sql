-- Persist one active context budget ledger for every conversation/Agent pair.
CREATE TABLE IF NOT EXISTS agent_sessions (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    cli_session_id TEXT NOT NULL DEFAULT '',
    cli_tool VARCHAR(50) NOT NULL DEFAULT '',
    generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
    lifecycle_status VARCHAR(20) NOT NULL DEFAULT 'active'
        CHECK (lifecycle_status IN ('active', 'rolled_over', 'closed', 'failed')),
    active_context_tokens BIGINT NOT NULL DEFAULT 0 CHECK (active_context_tokens >= 0),
    context_window_tokens BIGINT NOT NULL CHECK (context_window_tokens > 0),
    total_input_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_input_tokens >= 0),
    total_output_tokens BIGINT NOT NULL DEFAULT 0 CHECK (total_output_tokens >= 0),
    usage_ratio DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (usage_ratio >= 0),
    budget_status VARCHAR(20) NOT NULL DEFAULT 'normal'
        CHECK (budget_status IN ('normal', 'warning', 'critical')),
    usage_source VARCHAR(20) NOT NULL DEFAULT 'estimated'
        CHECK (usage_source IN ('estimated', 'actual')),
    compaction_count INTEGER NOT NULL DEFAULT 0 CHECK (compaction_count >= 0),
    checkpoint_id UUID REFERENCES conversation_checkpoints(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_sessions_generation
    ON agent_sessions (conversation_id, agent_id, generation);
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_sessions_active_pair
    ON agent_sessions (conversation_id, agent_id)
    WHERE lifecycle_status = 'active';
CREATE INDEX IF NOT EXISTS idx_agent_sessions_conversation
    ON agent_sessions (conversation_id, updated_at DESC);

---- DOWN
DROP TABLE IF EXISTS agent_sessions;
