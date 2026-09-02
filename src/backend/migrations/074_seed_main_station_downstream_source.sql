DO $migration$
DECLARE
    source_id UUID;
    admin_id UUID;
    source_ddl TEXT := $ddl$
CREATE EXTERNAL TABLE IF NOT EXISTS `main_station_180d_downstream` (
  `order_date` string COMMENT '订单发生日期，优先取B端开始日期，其次取C端开始日期',
  `duid` bigint COMMENT '滴滴用户ID',
  `order_id` string COMMENT '滴滴订单ID',
  `city_id` bigint COMMENT '订单城市ID',
  `station_id` string COMMENT '订单充电站ID',
  `station_name` string COMMENT '订单充电站名称',
  `connector_type_id` string COMMENT '枪类型ID：3慢枪、4快枪',
  `charge_start_time` string COMMENT '充电开始时间，优先取B端开始时间',
  `charge_end_time` string COMMENT '充电结束时间，优先取B端结束时间',
  `charge_duration_min` double COMMENT '充电时长，单位分钟；时间无效时为空',
  `charge_product_type` string COMMENT '充电产品类型：QUICKSTART/ACCELERATION/NORMAL',
  `is_member_order` bigint COMMENT '是否会员订单',
  `total_charge_kwh` double COMMENT '订单总充电度数',
  `valley_charge_kwh` double COMMENT '谷时充电度数',
  `label_total_fee` double COMMENT '标签价金额',
  `market_total_fee` double COMMENT '订单市场价总金额',
  `active_total_fee` double COMMENT '订单活动总金额',
  `receipts_fee` double COMMENT '订单实收金额',
  `coupon_fee` double COMMENT '订单优惠券金额',
  `promotion_total_fee` double COMMENT '订单优惠总金额',
  `label_unit_price` double COMMENT '标签价每度价格，单位元/度',
  `market_unit_price` double COMMENT '市场价每度价格，单位元/度',
  `active_total_unit_price` double COMMENT '活动价每度价格，单位元/度',
  `receipts_unit_price` double COMMENT '实收每度价格，单位元/度',
  `nearest_joinstation_id` string COMMENT '同城最近互联场站ID',
  `nearest_joinstation_name` string COMMENT '同城最近互联场站名称',
  `nearest_joinstation_distance_km` double COMMENT '订单场站到最近互联场站距离，单位km',
  `nearest_joinstation_distance_band` string COMMENT '距离档位：SELF/LE_3KM/GT_3_LE_5KM/GT_5_LE_10KM/GT_10KM',
  `nearest_joinstation_is_order_station_flag` int COMMENT '订单场站是否就是最近互联场站：1是、0否',
  `nearest_joinstation_price_period` string COMMENT '订单匹配的互联价格30分钟时段',
  `nearest_joinstation_price_period_type` int COMMENT '互联价格时段类型：1尖、2峰、3平、4谷',
  `nearest_joinstation_price_period_match_status` string COMMENT '订单时间与互联价格时段匹配状态',
  `nearest_joinstation_current_market_total_fee` double COMMENT '最近互联场站同一时段市场总单价',
  `nearest_joinstation_current_active_total_fee` double COMMENT '最近互联场站同一时段活动总单价',
  `selected_price_scope` string COMMENT '周边参考价范围：3KM/5KM/CITY',
  `selected_market_avg_total_fee` double COMMENT '选中范围的市场总单价均价',
  `selected_active_avg_total_fee` double COMMENT '选中范围的活动总单价均价',
  `selected_price_status` string COMMENT '周边参考价选取状态',
  `active_price_diff_yuan_per_kwh` double COMMENT '订单活动单价减周边活动均价，单位元/度',
  `active_price_compare_status` string COMMENT '活动价比较：CHEAPER/SAME/EXPENSIVE/UNAVAILABLE',
  `order_busy_station_flag` int COMMENT '订单开始小时是否为真实繁忙：1是、0否、空不可判断',
  `station_busy_hour_match_status` string COMMENT '订单与场站小时匹配状态',
  `station_busy_level` string COMMENT '订单所在场站小时忙闲档位：繁忙/适中/充足/未知',
  `station_busy_actual_free_rate` double COMMENT '订单所在场站小时真实空闲率',
  `valid_station_timed_order_cnt_180d` bigint COMMENT 'DUID近180天有效场站时间订单数',
  `busy_station_order_cnt_180d` bigint COMMENT 'DUID近180天繁忙场站订单数',
  `busy_station_order_rate_180d` double COMMENT 'DUID近180天繁忙场站订单占比'
) COMMENT '近180天充电订单API与报表下游表，不包含C4经纬度字段'
PARTITIONED BY (`dt` string COMMENT '180天订单快照截止业务日期，格式yyyy-MM-dd')
$ddl$;
    v_api_example TEXT := $example$
curl -X POST 'http://10.88.128.15:8000/dataservice/gateway/v1/api/main_station_180d_downstream' \
  -H 'Content-Type: application/json' \
  -H 'User-Agent: data-service-sdk-v1' \
  -H 'sign: ${REPORT_MAIN_STATION_SIGN}' \
  -H 'x-app-key: ${REPORT_MAIN_STATION_APP_KEY}' \
  -H 'x-date: ${REPORT_MAIN_STATION_DATE}' \
  -H 'Accept: application/json' \
  -d '{"apiName":"main_station_180d_downstream","fieldList":[{"name":"order_date","expression":null,"alias":"order_date","aggFunctionEnum":null,"checkCityAuth":null,"calcType":null,"authConfigList":null,"financeAuth":null,"comment":null,"metricStatusType":"VALIDITY","composeDimensions":null,"fillZero":false},{"name":"city_id","expression":null,"alias":"city_id","aggFunctionEnum":null,"checkCityAuth":null,"calcType":null,"authConfigList":null,"financeAuth":null,"comment":null,"metricStatusType":"VALIDITY","composeDimensions":null,"fillZero":false},{"name":"order_id","expression":null,"alias":"order_id","aggFunctionEnum":null,"checkCityAuth":null,"calcType":null,"authConfigList":null,"financeAuth":null,"comment":null,"metricStatusType":"VALIDITY","composeDimensions":null,"fillZero":false}],"conditionList":[{"name":"dt","value":"2026-08-26","operatorEnum":"EQ","orList":null,"conditionType":null,"linkEnum":null}],"whereWrapperDTO":null,"condition":null,"groupList":[],"orderBy":null,"needPagination":true,"needShowSql":null,"settings":null,"pageSize":10,"page":1,"disableCache":null,"postQueryDTO":null,"queryId":null,"authUser":null,"checkAuth":null,"orderList":null,"useMockData":false,"useTestVersion":false,"queryTypeEnum":"SYNC","outCalcDTO":null,"guaranteedQuery":null,"onlyShowSql":null,"downloadProperties":null}'
$example$;
    v_response_example TEXT := $response$
{
  "httpStatus": 200,
  "resultCode": "0",
  "returnMsg": "success",
  "success": true,
  "consumeMillis": 9008,
  "data": {
    "data": [
      {"order_date":"2022-01-18","order_id":"469052033","city_id":3},
      {"order_date":"2022-01-18","order_id":"469107653","city_id":24},
      {"order_date":"2022-01-18","order_id":"468987639","city_id":3}
    ],
    "paginationDTO": {"total":904733548,"pageSize":10,"pageCount":90473355,"page":1},
    "sql": "SELECT order_date AS order_date, city_id AS city_id, order_id AS order_id FROM ds_epower_platform_main_station_180d_downstream_41665 WHERE dt = '2026-08-26' ORDER BY order_date LIMIT 0,10",
    "queryId": "ClickHouse_<query_id>",
    "maxAccPartition": {"dt":"2026-08-27"},
    "needContinue": false,
    "empty": false
  }
}
$response$;
BEGIN
    SELECT id INTO admin_id
    FROM users
    WHERE username = '121' AND is_admin = TRUE
    LIMIT 1;

    IF admin_id IS NULL THEN
        SELECT id INTO admin_id FROM users WHERE is_admin = TRUE ORDER BY created_at LIMIT 1;
    END IF;

    IF admin_id IS NULL THEN
        RAISE EXCEPTION 'cannot seed main_station_180d_downstream without an admin user';
    END IF;

    SELECT id INTO source_id
    FROM report_data_sources
    WHERE api_name = 'main_station_180d_downstream'
    ORDER BY created_at
    LIMIT 1;

    IF source_id IS NULL THEN
        source_id := '04185aa2-2546-4577-ab3f-3d752c7bb403';
        INSERT INTO report_data_sources (
            id, name, endpoint, api_name, app_key_env, signature_env, x_date_env,
            api_example, response_example, hive_table, hive_ddl, hive_example,
            enabled, created_by
        ) VALUES (
            source_id,
            'epower_platform.main_station_180d_downstream',
            'http://10.88.128.15:8000',
            'main_station_180d_downstream',
            'REPORT_MAIN_STATION_APP_KEY',
            'REPORT_MAIN_STATION_SIGN',
            'REPORT_MAIN_STATION_DATE',
            v_api_example,
            v_response_example,
            'epower_platform.main_station_180d_downstream',
            source_ddl,
            $sql$SELECT order_date AS `order_date`, city_id AS `city_id`, order_id AS `order_id`
FROM ds_epower_platform_main_station_180d_downstream_41665
WHERE dt = '2026-08-26'
ORDER BY order_date
LIMIT 0, 10;$sql$,
            TRUE,
            admin_id
        );
    ELSE
        UPDATE report_data_sources
        SET name = 'epower_platform.main_station_180d_downstream',
            endpoint = 'http://10.88.128.15:8000',
            app_key_env = 'REPORT_MAIN_STATION_APP_KEY',
            signature_env = 'REPORT_MAIN_STATION_SIGN',
            x_date_env = 'REPORT_MAIN_STATION_DATE',
            api_example = v_api_example,
            response_example = v_response_example,
            hive_table = 'epower_platform.main_station_180d_downstream',
            hive_ddl = source_ddl,
            hive_example = $sql$SELECT order_date AS `order_date`, city_id AS `city_id`, order_id AS `order_id`
FROM ds_epower_platform_main_station_180d_downstream_41665
WHERE dt = '2026-08-26'
ORDER BY order_date
LIMIT 0, 10;$sql$,
            enabled = TRUE,
            updated_at = NOW()
        WHERE id = source_id;
    END IF;

    DELETE FROM report_data_source_fields WHERE data_source_id = source_id;

    INSERT INTO report_data_source_fields (
        data_source_id, name, data_type, label, description, sensitive, enabled,
        selectable, filterable, groupable, aggregatable, sortable
    )
    SELECT
        source_id,
        parsed[1],
        UPPER(REGEXP_REPLACE(parsed[2], '\s+', '', 'g')),
        '',
        COALESCE(parsed[3], ''),
        FALSE,
        TRUE,
        TRUE,
        TRUE,
        TRUE,
        UPPER(SPLIT_PART(parsed[2], '(', 1)) IN (
            'TINYINT', 'SMALLINT', 'INT', 'INTEGER', 'BIGINT', 'LONG',
            'FLOAT', 'DOUBLE', 'DECIMAL', 'NUMERIC'
        ),
        TRUE
    FROM REGEXP_MATCHES(
        source_ddl,
        '`([^`]+)`\s+([a-z]+(?:\s*\([^)]*\))?)(?:\s+COMMENT\s+''([^'']*)'')?',
        'gi'
    ) AS parsed;
END
$migration$;

---- DOWN
DELETE FROM report_data_sources WHERE api_name = 'main_station_180d_downstream';
