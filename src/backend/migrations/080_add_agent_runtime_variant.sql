-- Preserve every runnable CLI/Desktop candidate independently and remember the
-- exact runtime selected when a user creates an Agent.
ALTER TABLE agents
    ADD COLUMN IF NOT EXISTS runtime_variant VARCHAR(16) NOT NULL DEFAULT 'cli';

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_runtime_variant_check;
ALTER TABLE agents ADD CONSTRAINT agents_runtime_variant_check
    CHECK (runtime_variant IN ('cli', 'desktop'));

-- Before this migration each machine/product had only one candidate, so it is
-- safe to recover the runtime selected by already-created daemon Agents.
UPDATE agents a
SET runtime_variant = c.variant
FROM daemon_agent_candidates c
WHERE a.machine_id = c.machine_id
  AND a.cli_tool = c.cli_tool
  AND c.variant IN ('cli', 'desktop');

DROP INDEX IF EXISTS idx_daemon_agent_candidates_machine_cli;
CREATE UNIQUE INDEX IF NOT EXISTS idx_daemon_agent_candidates_machine_cli_variant
    ON daemon_agent_candidates (machine_id, cli_tool, variant);

CREATE INDEX IF NOT EXISTS idx_agents_machine_cli_variant
    ON agents (machine_id, cli_tool, runtime_variant)
    WHERE machine_id IS NOT NULL;

---- DOWN
DROP INDEX IF EXISTS idx_agents_machine_cli_variant;
DROP INDEX IF EXISTS idx_daemon_agent_candidates_machine_cli_variant;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_runtime_variant_check;
-- A down migration can only restore the old uniqueness after collapsing the
-- newly valid multiple variants to CLI-first rows.
DELETE FROM daemon_agent_candidates c
USING daemon_agent_candidates duplicate
WHERE c.machine_id = duplicate.machine_id
  AND c.cli_tool = duplicate.cli_tool
  AND c.id <> duplicate.id
  AND (CASE WHEN c.variant = 'cli' THEN 0 ELSE 1 END, c.created_at, c.id)
      > (CASE WHEN duplicate.variant = 'cli' THEN 0 ELSE 1 END, duplicate.created_at, duplicate.id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_daemon_agent_candidates_machine_cli
    ON daemon_agent_candidates (machine_id, cli_tool);
ALTER TABLE agents DROP COLUMN IF EXISTS runtime_variant;
