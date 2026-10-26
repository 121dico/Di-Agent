--SPARK_SQL
-- 安心充每日滚动指标。BIZ_DATE_LINE=统计日，不复写过去 14 天。
-- 前置：01_axc_audience_daily.sql 的同日分区已成功生成。
-- 原始订单字段是近 30 天滚动值，不是当日新增订单。
SELECT assert_true(count(*) > 0, 'same-day audience partition empty')
FROM epower_platform.ads_delivery_audience_snapshot_di
WHERE dt = '${BIZ_DATE_LINE}' AND crowd_id = 'crowd_axc_low_freq';

CREATE EXTERNAL TABLE IF NOT EXISTS epower_platform.ads_delivery_user_effect_di (
  stat_dt string, crowd_id string, duid bigint, group_type string,
  charge_life_cycle string, charge_freq_type string,
  charge_duid_role_name_v2_type string, member_status string,
  city_name string, city_fenkuang string, charge_region string,
  axc_ord_cnt_30d bigint, chg_ord_cnt_30d bigint,
  effect_rate double, target_rate double,
  achieved_flag int, unmet_flag int, metric_status string
)
PARTITIONED BY (dt string) STORED AS ORC
LOCATION 'hdfs://DClusterNmg5/user/prod_epower_platform/epower_platform/hive/epower_platform/ads_delivery_user_effect_rebuild_20260923_di';

INSERT OVERWRITE TABLE epower_platform.ads_delivery_user_effect_di
PARTITION (dt = '${BIZ_DATE_LINE}')
SELECT
  '${BIZ_DATE_LINE}' AS stat_dt,
  a.crowd_id,
  a.duid,
  a.group_type,
  a.charge_life_cycle,
  a.charge_freq_type,
  a.charge_duid_role_name_v2_type,
  a.member_status,
  a.city_name,
  a.city_fenkuang,
  a.charge_region,
  a.axc_ord_cnt_30d,
  a.chg_ord_cnt_30d,
  CASE WHEN a.chg_ord_cnt_30d > 0
         AND a.axc_ord_cnt_30d IS NOT NULL
       THEN CAST(a.axc_ord_cnt_30d AS double)
            / CAST(a.chg_ord_cnt_30d AS double)
       ELSE CAST(NULL AS double) END AS effect_rate,
  CAST(NULL AS double) AS target_rate,
  CAST(NULL AS int) AS achieved_flag,
  CAST(NULL AS int) AS unmet_flag,
  CASE WHEN a.chg_ord_cnt_30d IS NULL
         OR a.axc_ord_cnt_30d IS NULL THEN 'source_missing'
       WHEN a.chg_ord_cnt_30d = 0 THEN 'denominator_zero'
       ELSE 'rate_available_target_missing' END AS metric_status
FROM epower_platform.ads_delivery_audience_snapshot_di a
WHERE a.dt = '${BIZ_DATE_LINE}'
  AND a.crowd_id = 'crowd_axc_low_freq';

SELECT assert_true(count(*) = count(DISTINCT duid), 'duplicate effect output')
FROM epower_platform.ads_delivery_user_effect_di
WHERE dt = '${BIZ_DATE_LINE}';

SELECT assert_true(e.users = a.users, 'effect/audience user count mismatch')
FROM (
  SELECT count(*) AS users
  FROM epower_platform.ads_delivery_user_effect_di
  WHERE dt = '${BIZ_DATE_LINE}'
) e
CROSS JOIN (
  SELECT count(*) AS users
  FROM epower_platform.ads_delivery_audience_snapshot_di
WHERE dt = '${BIZ_DATE_LINE}' AND crowd_id = 'crowd_axc_low_freq'
) a;

SELECT metric_status, count(*) AS users,
  count(effect_rate) AS effect_rate_covered_users
FROM epower_platform.ads_delivery_user_effect_di
WHERE dt = '${BIZ_DATE_LINE}' AND crowd_id = 'crowd_axc_low_freq'
GROUP BY metric_status ORDER BY metric_status;
