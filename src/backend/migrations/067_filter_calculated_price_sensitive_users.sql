UPDATE report_definitions
SET query_json = jsonb_set(
        jsonb_set(
            query_json,
            '{conditionList}',
            '[{"name":"price_sensitivity_score","operatorEnum":"NOT_NULL"}]'::jsonb
        ),
        '{pageSize}',
        '100'::jsonb
    ),
    updated_at = NOW()
WHERE name = '价格敏感度全量画像';

---- DOWN
UPDATE report_definitions
SET query_json = jsonb_set(
        jsonb_set(query_json, '{conditionList}', '[]'::jsonb),
        '{pageSize}',
        '20'::jsonb
    ),
    updated_at = NOW()
WHERE name = '价格敏感度全量画像';
