ALTER TABLE report_data_sources
    ADD COLUMN IF NOT EXISTS api_example TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS hive_table VARCHAR(240) NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS hive_example TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS report_data_source_fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id UUID NOT NULL REFERENCES report_data_sources(id) ON DELETE CASCADE,
    name VARCHAR(180) NOT NULL,
    data_type VARCHAR(80) NOT NULL,
    label VARCHAR(180) NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    sensitive BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    selectable BOOLEAN NOT NULL DEFAULT FALSE,
    filterable BOOLEAN NOT NULL DEFAULT FALSE,
    groupable BOOLEAN NOT NULL DEFAULT FALSE,
    aggregatable BOOLEAN NOT NULL DEFAULT FALSE,
    sortable BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (data_source_id, name)
);

CREATE INDEX IF NOT EXISTS idx_report_data_source_fields_source_enabled
    ON report_data_source_fields(data_source_id, enabled);

UPDATE report_data_sources
SET hive_table = 'ds_epower_platform_price_sensitive_41537',
    hive_example = 'SELECT duid, price_sensitivity_score FROM ds_epower_platform_price_sensitive_41537 LIMIT 10'
WHERE api_name = 'price_sensitive' AND hive_table = '';

INSERT INTO report_data_source_fields
    (data_source_id, name, data_type, enabled, selectable, filterable, groupable, aggregatable, sortable)
SELECT DISTINCT definition.data_source_id, field.value->>'name', 'UNKNOWN', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE
FROM report_definitions AS definition
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(definition.query_json->'fieldList', '[]'::jsonb)) AS field(value)
WHERE COALESCE(field.value->>'name', '') <> ''
ON CONFLICT (data_source_id, name) DO NOTHING;

---- DOWN
DROP TABLE IF EXISTS report_data_source_fields;
ALTER TABLE report_data_sources
    DROP COLUMN IF EXISTS hive_example,
    DROP COLUMN IF EXISTS hive_table,
    DROP COLUMN IF EXISTS api_example;
