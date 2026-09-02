DO $migration$
DECLARE
    source_id UUID;
    admin_id UUID;
    query_document JSONB;
BEGIN
    SELECT id
    INTO source_id
    FROM report_data_sources
    WHERE api_name = 'price_sensitive'
    ORDER BY updated_at DESC
    LIMIT 1;

    IF source_id IS NULL THEN
        RETURN;
    END IF;

    SELECT id
    INTO admin_id
    FROM users
    WHERE username = '121' AND is_admin = TRUE
    LIMIT 1;

    IF admin_id IS NULL THEN
        SELECT id INTO admin_id FROM users WHERE is_admin = TRUE ORDER BY created_at LIMIT 1;
    END IF;

    SELECT jsonb_build_object(
        'fieldList', COALESCE(
            jsonb_agg(
                jsonb_build_object('name', field.name)
                ORDER BY CASE field.name
                    WHEN 'duid' THEN 0
                    WHEN 'dt' THEN 1
                    WHEN 'user_city_id' THEN 2
                    WHEN 'user_city_name' THEN 3
                    WHEN 'price_sensitivity_score' THEN 4
                    WHEN 'price_sensitivity_level' THEN 5
                    WHEN 'promotion_sensitivity_level' THEN 6
                    WHEN 'price_sensitivity_type' THEN 7
                    WHEN 'price_evidence_status' THEN 8
                    WHEN 'd1_recent_order_count' THEN 9
                    WHEN 'd1_price_score' THEN 10
                    WHEN 'd2_coupon_score' THEN 11
                    WHEN 'd3_time_score' THEN 12
                    ELSE 100
                END,
                field.name
            ),
            '[]'::jsonb
        ),
        'conditionList', jsonb_build_array(
            jsonb_build_object('name', 'price_sensitivity_score', 'operatorEnum', 'NOT_NULL')
        ),
        'groupList', '[]'::jsonb,
        'orderBy', 'duid',
        'needPagination', TRUE,
        'pageSize', 100,
        'page', 1,
        'queryTypeEnum', 'SYNC',
        'useMockData', FALSE,
        'useTestVersion', FALSE
    )
    INTO query_document
    FROM report_data_source_fields AS field
    WHERE field.data_source_id = source_id
      AND field.enabled = TRUE
      AND field.selectable = TRUE;

    DELETE FROM report_runs
    WHERE report_id IN (SELECT id FROM report_definitions WHERE data_source_id = source_id);

    DELETE FROM report_definitions WHERE data_source_id = source_id;

    INSERT INTO report_definitions
        (id, name, description, data_source_id, query_json, visualization_json, enabled, created_by)
    VALUES
        (
            '86d3c8f1-e8f7-4d70-9143-3392a8d4d291',
            '价敏用户报表',
            '基于 epower_platform.price_sensitive，展示已计算价敏指标用户的规模、等级分布、标签观察趋势与用户明细。',
            source_id,
            query_document,
            '{
              "metrics": [
                {"field":"price_sensitivity_score","label":"价敏均分","suffix":"分"},
                {"field":"d1_recent_order_count","label":"参与计算订单数","suffix":"单"},
                {"field":"price_sensitivity_level","label":"价敏等级"},
                {"field":"price_sensitivity_type","label":"价敏类型"}
              ],
              "chart": {
                "xField":"dt",
                "series":[
                  {"field":"price_sensitivity_score","label":"价敏均分","color":"#0F766E"},
                  {"field":"d1_price_score","label":"D1 价格分","color":"#34A853"},
                  {"field":"d2_coupon_score","label":"D2 优惠分","color":"#D89B2B"},
                  {"field":"d3_time_score","label":"D3 时间分","color":"#3B82F6"}
                ]
              },
              "detail":{"defaultGroup":"result"},
              "analytics":{"enabled":true,"timeField":"dt","timeSemantics":"label_observation_date"}
            }'::jsonb,
            TRUE,
            admin_id
        );
END
$migration$;

---- DOWN
DELETE FROM report_runs WHERE report_id = '86d3c8f1-e8f7-4d70-9143-3392a8d4d291';
DELETE FROM report_definitions WHERE id = '86d3c8f1-e8f7-4d70-9143-3392a8d4d291';
