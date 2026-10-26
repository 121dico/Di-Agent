--SPARK_SQL
-- 只读预检：先跑并保存结果，再决定 Apollo 用户键和有效订单表。
SHOW TABLES IN charge_dw LIKE 'dwd_charge_trd_order_di';
SHOW TABLES IN charge_dw LIKE 'dm_charge_trd_order_di';

-- 召回投放前 1 天、进组期和每人 D+7 标签期必须逐日检查。
SELECT dt, count(*) AS tag_rows, count(DISTINCT duid) AS tag_duids,
  count(charge_life_cycle) AS lifecycle_nonnull_rows,
  count(duid_role_name_v2_type_hg) AS identity_nonnull_rows,
  count(normal_cbill_order_cnt_30d) AS frequency_nonnull_rows
FROM charge_dw.app_charge_tag_duid_df
WHERE (dt BETWEEN '2026-08-11' AND '2026-08-31')
   OR dt IN ('2026-09-21', '2026-09-22')
GROUP BY dt ORDER BY dt;

SELECT dt, count(*) AS axc_rows
FROM charge_dw.app_charge_axc_dashou_duid_df
WHERE dt IN ('2026-09-21', '2026-09-22') AND a_type = 1
GROUP BY dt ORDER BY dt;

SELECT dt, count(*) AS city_rows
FROM charge_dw.dim_charge_city
WHERE (dt BETWEEN '2026-08-11' AND '2026-08-31')
   OR dt IN ('2026-09-21', '2026-09-22')
GROUP BY dt ORDER BY dt;

-- 先用本查询确认 PRD 频次字段实际存在，再提交 SQL-1。
SELECT dt,
  count(*) AS low_freq_rows,
  count(normal_cbill_order_cnt_30d) AS frequency_nonnull_rows,
  count(duid_role_name_v2_type_hg) AS identity_nonnull_rows,
  count(charge_active_member_end_time) AS member_end_nonnull_rows
FROM charge_dw.app_charge_tag_duid_df
WHERE dt IN ('2026-09-21', '2026-09-22')
  AND axc_freq_type = '低频购买用户'
GROUP BY dt ORDER BY dt;

-- AB Master 页面写实验对象 DUID；PRD 示例把 apollo_key 当 UID。
-- 比较同日标签直接命中 DUID 与 UID 映射覆盖，不根据列名猜。
WITH apollo AS (
  SELECT DISTINCT ymd, apollo_key
  FROM apollo.pre_flow_data_bak
  WHERE ymd BETWEEN '2026-08-12' AND '2026-08-24'
    AND exp = 'zhaohuifugou'
    AND group_name IN ('control_group', 'treatment_group')
    AND apollo_key > 0
),
uid_map AS (
  SELECT DISTINCT dt, uid, duid
  FROM epub_dw.dim_energy_user
  WHERE dt BETWEEN '2026-08-12' AND '2026-08-24' AND duid > 0
),
direct_duid AS (
  SELECT DISTINCT dt, duid
  FROM charge_dw.app_charge_tag_duid_df
  WHERE dt BETWEEN '2026-08-12' AND '2026-08-24' AND duid > 0
)
SELECT
  a.ymd AS entry_dt,
  count(DISTINCT a.apollo_key) AS apollo_keys,
  count(DISTINCT CASE WHEN m.duid IS NOT NULL THEN a.apollo_key END)
    AS keys_matching_uid,
  count(DISTINCT CASE WHEN d.duid IS NOT NULL THEN a.apollo_key END)
    AS keys_matching_duid,
  count(DISTINCT m.duid) AS mapped_duids
FROM apollo a
LEFT JOIN uid_map m ON a.ymd = m.dt AND a.apollo_key = m.uid
LEFT JOIN direct_duid d
  ON a.ymd = d.dt AND CAST(a.apollo_key AS bigint) = d.duid
GROUP BY a.ymd ORDER BY a.ymd;

-- 若一个 UID 当天关联多个 DUID，现有 UID 映射也不能直接作为稳定实验主体。
SELECT dt, count(*) AS multi_duid_uids
FROM (
  SELECT dt, uid
  FROM epub_dw.dim_energy_user
  WHERE dt BETWEEN '2026-08-12' AND '2026-08-24' AND duid > 0
  GROUP BY dt, uid HAVING count(DISTINCT duid) > 1
) x GROUP BY dt ORDER BY dt;

-- 以下核对现有 SQL 所用的 UID -> DUID 路径有多少同日跨组。
WITH candidate AS (
  SELECT DISTINCT a.ymd AS entry_dt, b.duid, a.group_name
  FROM apollo.pre_flow_data_bak a
  JOIN epub_dw.dim_energy_user b
    ON a.ymd = b.dt AND a.apollo_key = b.uid
  WHERE a.ymd BETWEEN '2026-08-12' AND '2026-08-24'
    AND a.exp = 'zhaohuifugou'
    AND a.group_name IN ('control_group', 'treatment_group')
    AND b.duid > 0
)
SELECT count(*) AS conflicting_duid_days
FROM (
  SELECT entry_dt, duid
  FROM candidate
  GROUP BY entry_dt, duid
  HAVING count(DISTINCT group_name) > 1
) c;

-- 累计实验比较还要求整个活动期一个 DUID 只属于一个组；同日无冲突并不充分。
WITH candidate AS (
  SELECT DISTINCT b.duid, a.group_name
  FROM apollo.pre_flow_data_bak a
  JOIN epub_dw.dim_energy_user b
    ON a.ymd = b.dt AND a.apollo_key = b.uid
  WHERE a.ymd BETWEEN '2026-08-12' AND '2026-08-24'
    AND a.exp = 'zhaohuifugou'
    AND a.group_name IN ('control_group', 'treatment_group')
    AND b.duid > 0
)
SELECT count(*) AS conflicting_duids_in_campaign
FROM (
  SELECT duid FROM candidate GROUP BY duid
  HAVING count(DISTINCT group_name) > 1
) c;

SELECT dt, count(*) AS valid_order_rows
FROM charge_dw.dwd_charge_trd_order_di
WHERE dt BETWEEN '2026-08-13' AND '2026-08-31'
  AND is_trd = 1 AND coalesce(is_cbill, 1) = 1
  AND coalesce(is_test, 0) = 0
GROUP BY dt ORDER BY dt;

-- 九个批次来自原召回复购 SQL；验证它们确有发券且与进组日相符。
SELECT CAST(am_batch_id AS string) AS am_batch_id,
  count(DISTINCT concat(CAST(duid AS string), '#', CAST(to_date(bind_time) AS string)))
    AS duid_bind_days
FROM epub_dw.dwd_pub_mkt_coupon_instance_df
WHERE dt BETWEEN '2026-08-11' AND '2026-08-31'
  AND to_date(bind_time) BETWEEN '2026-08-12' AND '2026-08-24'
  AND CAST(am_batch_id AS string) IN (
    '6065393250247640683', '6079956535982687601', '6086496452879582289',
    '6079957319596115386', '6079958048377406471', '6086496793033442360',
    '6079958471528154469', '6079958744266966376', '6086497075637257271'
  )
GROUP BY CAST(am_batch_id AS string)
ORDER BY am_batch_id;
