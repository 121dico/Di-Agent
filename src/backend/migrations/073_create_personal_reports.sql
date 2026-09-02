CREATE TABLE IF NOT EXISTS personal_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
    data_source_id UUID REFERENCES report_data_sources(id) ON DELETE SET NULL,
    title VARCHAR(180) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status VARCHAR(24) NOT NULL DEFAULT 'draft',
    style_preset VARCHAR(80) NOT NULL DEFAULT 'balanced',
    style_prompt TEXT NOT NULL DEFAULT '',
    query_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    document_json JSONB NOT NULL DEFAULT '{"sections":[]}'::jsonb,
    provenance_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT personal_reports_status_check CHECK (status IN ('draft', 'saved', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_personal_reports_owner_updated
    ON personal_reports(owner_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_personal_reports_conversation
    ON personal_reports(conversation_id, updated_at DESC)
    WHERE conversation_id IS NOT NULL;

---- DOWN
DROP TABLE IF EXISTS personal_reports;
