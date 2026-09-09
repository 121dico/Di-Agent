CREATE TABLE IF NOT EXISTS agent_model_runtime (
 agent_id UUID PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
 configured_model TEXT NOT NULL DEFAULT '',
 observed_model TEXT NOT NULL DEFAULT '',
 context_window BIGINT,
 observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
---- DOWN
DROP TABLE IF EXISTS agent_model_runtime;
