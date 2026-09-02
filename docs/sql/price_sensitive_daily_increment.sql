-- SPARK_SQL
-- 价敏日报增量聚合（回填/初始化版本）
-- 输入：
--   ${START_DATE}       统计起始日，例如 2026-07-28
--   ${END_DATE}         统计结束日，例如 2026-08-27
--   ${BASELINE_DATE}    起始日前一日，例如 2026-07-27
-- 粒度：dt + user_city_id + user_city_name
--
-- 口径：
--   active_price_sensitive_users  当日可计算价敏分的用户存量
--   entered_users                 昨日未在价敏集合、今日进入的用户（含回流）
--   exited_users                  昨日在价敏集合、今日退出的用户
--   net_growth_users              entered_users - exited_users
--   cumulative_net_growth_users   相对 BASELINE_DATE 的累计净变化
--   daily_growth_rate             net_growth_users / 前一日价敏用户存量
--   daily_order_count / gmv       toc_charge_s_time 发生在当日的真实订单，不使用180天窗口累计值

CREATE TABLE IF NOT EXISTS epower_platform.price_sensitive_daily_increment (
    user_city_id                       BIGINT COMMENT '用户城市ID，空值归入未知城市',
    user_city_name                     STRING COMMENT '用户城市名称，空值归入未知城市',
    active_price_sensitive_users       BIGINT COMMENT '当日可计算价敏分用户数',
    entered_users                      BIGINT COMMENT '相邻观察日进入价敏集合用户数，含回流',
    exited_users                       BIGINT COMMENT '相邻观察日退出价敏集合用户数',
    net_growth_users                   BIGINT COMMENT '进入减退出',
    cumulative_net_growth_users        BIGINT COMMENT '相对基线日的累计净变化',
    daily_growth_rate                  DOUBLE COMMENT '净增/前一日价敏用户数',
    daily_order_count                  BIGINT COMMENT '真实充电开始日在当日的去重订单数',
    daily_order_users                  BIGINT COMMENT '真实充电开始日在当日的去重下单用户数',
    daily_gmv                          DOUBLE COMMENT '真实充电开始日在当日的活动总金额',
    avg_price_sensitivity_score        DOUBLE COMMENT '当日价敏用户平均分',
    high_sensitivity_users             BIGINT COMMENT '当日高价敏用户数',
    medium_sensitivity_users           BIGINT COMMENT '当日中价敏用户数',
    low_sensitivity_users              BIGINT COMMENT '当日低价敏用户数'
)
COMMENT '价敏用户日增量、真实订单和GMV聚合'
PARTITIONED BY (dt STRING COMMENT '统计日 yyyy-MM-dd')
STORED AS ORC;

WITH
snapshot AS (
    SELECT
        dt,
        duid,
        coalesce(user_city_id, -1) AS user_city_id,
        coalesce(user_city_name, '未知城市') AS user_city_name,
        CASE WHEN price_sensitivity_score IS NOT NULL THEN 1 ELSE 0 END AS is_qualified,
        price_sensitivity_score,
        price_sensitivity_level
    FROM epower_platform.price_sensitive
    WHERE dt BETWEEN '${BASELINE_DATE}' AND '${END_DATE}'
      AND duid IS NOT NULL
      AND duid > 0
),
paired AS (
    SELECT
        dt,
        duid,
        user_city_id,
        user_city_name,
        is_qualified,
        price_sensitivity_score,
        price_sensitivity_level,
        lag(is_qualified, 1, 0) OVER (PARTITION BY duid ORDER BY dt) AS previous_is_qualified
    FROM snapshot
),
user_delta AS (
    SELECT
        dt,
        user_city_id,
        user_city_name,
        duid,
        is_qualified,
        price_sensitivity_score,
        price_sensitivity_level,
        CASE WHEN is_qualified = 1 AND previous_is_qualified = 0 THEN 1 ELSE 0 END AS entered_flag,
        CASE WHEN is_qualified = 0 AND previous_is_qualified = 1 THEN 1 ELSE 0 END AS exited_flag
    FROM paired
    WHERE dt BETWEEN '${START_DATE}' AND '${END_DATE}'
),
daily_users AS (
    SELECT
        dt,
        user_city_id,
        user_city_name,
        sum(is_qualified) AS active_price_sensitive_users,
        sum(entered_flag) AS entered_users,
        sum(exited_flag) AS exited_users,
        sum(entered_flag) - sum(exited_flag) AS net_growth_users,
        avg(CASE WHEN is_qualified = 1 THEN price_sensitivity_score END) AS avg_price_sensitivity_score,
        sum(CASE WHEN is_qualified = 1 AND price_sensitivity_level = 'HIGH' THEN 1 ELSE 0 END) AS high_sensitivity_users,
        sum(CASE WHEN is_qualified = 1 AND price_sensitivity_level = 'MEDIUM' THEN 1 ELSE 0 END) AS medium_sensitivity_users,
        sum(CASE WHEN is_qualified = 1 AND price_sensitivity_level = 'LOW' THEN 1 ELSE 0 END) AS low_sensitivity_users
    FROM user_delta
    GROUP BY dt, user_city_id, user_city_name
),
order_source AS (
    SELECT
        dt,
        order_id,
        duid,
        CAST(active_total_fee AS DOUBLE) AS active_total_fee,
        row_number() OVER (
            PARTITION BY dt, order_id
            ORDER BY toc_charge_s_time DESC, duid DESC
        ) AS dedup_rank
    FROM epower_platform.main_station_180d
    WHERE dt BETWEEN '${START_DATE}' AND '${END_DATE}'
      AND order_id IS NOT NULL
      AND duid IS NOT NULL
      AND to_date(CAST(toc_charge_s_time AS TIMESTAMP)) = CAST(dt AS DATE)
),
daily_orders AS (
    SELECT
        o.dt,
        s.user_city_id,
        s.user_city_name,
        count(1) AS daily_order_count,
        count(DISTINCT o.duid) AS daily_order_users,
        sum(coalesce(o.active_total_fee, 0.0)) AS daily_gmv
    FROM order_source o
    JOIN snapshot s
      ON o.dt = s.dt
     AND o.duid = s.duid
    WHERE o.dedup_rank = 1
    GROUP BY o.dt, s.user_city_id, s.user_city_name
),
joined AS (
    SELECT
        u.*,
        coalesce(o.daily_order_count, 0) AS daily_order_count,
        coalesce(o.daily_order_users, 0) AS daily_order_users,
        coalesce(o.daily_gmv, 0.0) AS daily_gmv,
        lag(u.active_price_sensitive_users) OVER (
            PARTITION BY u.user_city_id, u.user_city_name ORDER BY u.dt
        ) AS previous_active_users
    FROM daily_users u
    LEFT JOIN daily_orders o
      ON u.dt = o.dt
     AND u.user_city_id = o.user_city_id
     AND u.user_city_name = o.user_city_name
),
final_metrics AS (
    SELECT
        *,
        sum(net_growth_users) OVER (
            PARTITION BY user_city_id, user_city_name
            ORDER BY dt ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ) AS cumulative_net_growth_users,
        CASE
            WHEN previous_active_users > 0
            THEN net_growth_users * 1.0 / previous_active_users
            ELSE 0.0
        END AS daily_growth_rate
    FROM joined
)
INSERT OVERWRITE TABLE epower_platform.price_sensitive_daily_increment PARTITION (dt)
SELECT
    user_city_id,
    user_city_name,
    active_price_sensitive_users,
    entered_users,
    exited_users,
    net_growth_users,
    cumulative_net_growth_users,
    round(daily_growth_rate, 8),
    daily_order_count,
    daily_order_users,
    round(daily_gmv, 2),
    round(avg_price_sensitivity_score, 4),
    high_sensitivity_users,
    medium_sensitivity_users,
    low_sensitivity_users,
    dt
FROM final_metrics;
