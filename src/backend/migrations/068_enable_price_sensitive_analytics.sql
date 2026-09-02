UPDATE report_definitions
SET visualization_json = jsonb_set(
        visualization_json,
        '{analytics}',
        '{"enabled":true}'::jsonb
    ),
    updated_at = NOW()
WHERE name = '价格敏感度全量画像';

---- DOWN
UPDATE report_definitions
SET visualization_json = visualization_json - 'analytics',
    updated_at = NOW()
WHERE name = '价格敏感度全量画像';
