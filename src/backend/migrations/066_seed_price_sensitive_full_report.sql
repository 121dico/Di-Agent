WITH source AS (
    SELECT id, created_by
    FROM report_data_sources
    WHERE api_name = 'price_sensitive' AND enabled = TRUE
    ORDER BY created_at DESC
    LIMIT 1
), fields AS (
    SELECT jsonb_agg(jsonb_build_object('name', field_name) ORDER BY ordinal) AS field_list
    FROM unnest(ARRAY[
        'duid', 'dt',
        'd1_recent_order_count', 'd1_valley_measurement_order_count', 'd1_valley_order_count',
        'd1_valley_order_share', 'd1_valley_avg_share', 'd1_valley_eligible_flag',
        'd1_valley_raw_score', 'd1_valley_score', 'd1_confirmed_price_sort_order_count',
        'd1_price_sort_floor_score', 'd1_comparable_price_order_count', 'd1_cheaper_price_order_count',
        'd1_same_price_order_count', 'd1_expensive_price_order_count', 'd1_cheaper_price_order_share',
        'd1_same_price_order_share', 'd1_expensive_price_order_share', 'd1_price_direction_index',
        'd1_actual_price_score', 'd1_evidence_status', 'd1_price_score',
        'd2_coupon_used_count', 'd2_coupon_expired_count', 'd2_coupon_total_count',
        'd2_coupon_use_rate', 'd2_evidence_status', 'd2_coupon_score',
        'd3_valid_station_order_count', 'd3_current_month_order_count', 'd3_current_month_order_share',
        'd3_new_customer_flag', 'd3_busy_order_count', 'd3_busy_order_rate',
        'd3_busy_station_count', 'd3_busy_date_count', 'd3_evidence_status', 'd3_time_score',
        'd4_is_vip', 'd4_vehicle_usage_type', 'd4_vehicle_brand', 'd4_vehicle_usage_coefficient',
        'd4_vehicle_brand_coefficient', 'd4_member_coefficient', 'd4_total_coefficient',
        'price_observable_opportunity_count', 'price_positive_evidence_count', 'price_counter_evidence_count',
        'price_positive_dimension_count', 'price_repeated_positive_flag', 'ready_behavior_dimension_count',
        'ready_behavior_weight_sum', 'price_evidence_status', 'd13_behavior_score',
        'price_sensitivity_score_before_d4', 'price_sensitivity_score', 'price_sensitivity_level',
        'promotion_sensitivity_level', 'price_sensitivity_type'
    ]) WITH ORDINALITY AS columns(field_name, ordinal)
)
INSERT INTO report_definitions
    (name, description, data_source_id, query_json, visualization_json, enabled, created_by)
SELECT
    '价格敏感度全量画像',
    '按 duid 浏览 D1-D4 行为证据、修正系数与最终价格敏感标签；全字段服务端分页查询。',
    source.id,
    jsonb_build_object(
        'fieldList', fields.field_list,
        'conditionList', jsonb_build_array(jsonb_build_object(
            'name', 'price_sensitivity_score',
            'operatorEnum', 'NOT_NULL'
        )),
        'groupList', '[]'::jsonb,
        'orderBy', 'duid',
        'needPagination', TRUE,
        'pageSize', 100,
        'page', 1
    ),
    '{
      "metrics": [
        {"field":"price_sensitivity_score","label":"最终价敏分","suffix":"分"},
        {"field":"d1_price_score","label":"D1 价格分","suffix":"分"},
        {"field":"d2_coupon_score","label":"D2 优惠分","suffix":"分"},
        {"field":"d3_time_score","label":"D3 时间分","suffix":"分"},
        {"field":"price_sensitivity_level","label":"价敏等级"},
        {"field":"price_sensitivity_type","label":"价敏类型"}
      ],
      "chart": {
        "xField":"duid",
        "series":[
          {"field":"price_sensitivity_score","label":"最终价敏分","color":"#F2802E"},
          {"field":"d1_price_score","label":"D1 价格分","color":"#4FB79A"},
          {"field":"d2_coupon_score","label":"D2 优惠分","color":"#9B7FD4"},
          {"field":"d3_time_score","label":"D3 时间分","color":"#E85D5D"}
        ]
      },
      "detail":{"defaultGroup":"result"},
      "analytics":{"enabled":true}
    }'::jsonb,
    TRUE,
    source.created_by
FROM source CROSS JOIN fields
WHERE NOT EXISTS (
    SELECT 1 FROM report_definitions WHERE name = '价格敏感度全量画像'
);

---- DOWN
DELETE FROM report_definitions WHERE name = '价格敏感度全量画像';
