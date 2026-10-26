--SPARK_SQL
-- 召回复购实验 v2：2026-08-12 至 2026-08-24 的真实 Apollo 进组、
-- 同日发券、每次进组后第 1-7 天复购。BIZ_DATE_LINE 为这次重算的观察截止日。
-- 先运行 00_recall_source_preflight.sql；本版沿用 PRD 的 apollo_key=uid 路径。
-- 若预检显示 apollo_key 实为 duid，禁止执行本脚本，须先改映射。
-- 输出 scope_type=rule_proxy_not_ditag：规则近似，不代表 Ditag 包成员。

SELECT assert_true(CAST('${BIZ_DATE_LINE}' AS date) >= CAST('2026-08-31' AS date),
  'D+7 not mature: run on/after 2026-08-31');

SELECT assert_true(count(*) > 0, 'Apollo source empty')
FROM apollo.pre_flow_data_bak
WHERE ymd BETWEEN '2026-08-12' AND '2026-08-24'
  AND exp = 'zhaohuifugou'
  AND group_name IN ('control_group', 'treatment_group');

-- 订单事件窗口必须完整；只检查最后一天会把中间缺分区误报为零复购。
SELECT assert_true(count(DISTINCT dt) = 19, 'order source date gap in D+7 window')
FROM charge_dw.dwd_charge_trd_order_di
WHERE dt BETWEEN '2026-08-13' AND '2026-08-31';

SELECT assert_true(count(*) > 0, 'pre-activity tag partition empty')
FROM charge_dw.app_charge_tag_duid_df
WHERE dt = '2026-08-11';

SELECT assert_true(count(DISTINCT dt) = 13, 'entry tag date gap')
FROM charge_dw.app_charge_tag_duid_df
WHERE dt BETWEEN '2026-08-12' AND '2026-08-24';

-- D+7 画像使用每位用户自己的进组日 + 7；13 个来源日期必须齐全。
SELECT assert_true(count(DISTINCT dt) = 13, 'D+7 tag date gap')
FROM charge_dw.app_charge_tag_duid_df
WHERE dt BETWEEN '2026-08-19' AND '2026-08-31';

SELECT assert_true(count(*) > 0, 'pre-activity city partition empty')
FROM charge_dw.dim_charge_city WHERE dt = '2026-08-11';

SELECT assert_true(count(*) = 0, 'conflicting pre-activity tag rows')
FROM (
  SELECT duid FROM (
    SELECT DISTINCT duid, charge_life_cycle,
      charge_duid_role_name_v2_type, duid_role_name_v2_type_hg,
      charge_is_member_active, charge_active_member_end_time,
      charge_freq_type, normal_cbill_order_cnt_30d,
      charge_most_order_city_id
    FROM charge_dw.app_charge_tag_duid_df
    WHERE dt = '2026-08-11' AND duid > 0
  ) x GROUP BY duid HAVING count(*) > 1
) bad;

SELECT assert_true(count(*) = 0, 'conflicting entry/D+7 tag rows')
FROM (
  SELECT label_dt, duid FROM (
    SELECT DISTINCT dt AS label_dt, duid,
      charge_life_cycle, charge_freq_type,
      charge_duid_role_name_v2_type, duid_role_name_v2_type_hg,
      charge_is_member_active, charge_active_member_end_time,
      normal_cbill_order_cnt_30d, charge_most_order_city_id
    FROM charge_dw.app_charge_tag_duid_df
    WHERE dt BETWEEN '2026-08-12' AND '2026-08-31' AND duid > 0
  ) x GROUP BY label_dt, duid HAVING count(*) > 1
) bad;

SELECT assert_true(count(*) = 0, 'conflicting city rows')
FROM (
  SELECT label_dt, city_id FROM (
    SELECT DISTINCT dt AS label_dt, city_id,
      city_name, city_fenkuang, charge_region
    FROM charge_dw.dim_charge_city
    WHERE dt BETWEEN '2026-08-11' AND '2026-08-31'
  ) x GROUP BY label_dt, city_id HAVING count(*) > 1
) bad;

CREATE EXTERNAL TABLE IF NOT EXISTS epower_platform.ads_delivery_coupon_funnel_di (
  entry_dt string, source_task_id string, duid bigint,
  group_type string, activity_cycle string,
  charge_life_cycle string, charge_duid_role_name_v2_type string,
  user_identity_prd string, charge_active_member_end_time string,
  member_status string, charge_freq_type string,
  normal_cbill_order_cnt_30d bigint, charge_freq_prd_bucket string,
  city_name string, city_fenkuang string, charge_region string,
  is_entry int, is_coupon int, is_full_coupon int,
  is_repurchase_7d int, is_coupon_repurchase_7d int,
  is_full_coupon_repurchase_7d int,
  label_dt string, scope_type string,
  group_conflict_flag int, activity_conflict_flag int,
  actual_coupon_batch_cnt bigint, expected_coupon_batch_cnt bigint,
  entry_charge_life_cycle string, entry_charge_freq_type string,
  source_charge_freq_type string,
  source_charge_duid_role_name_v2_type string,
  entry_label_dt string, entry_user_identity_prd string,
  entry_charge_active_member_end_time string, entry_member_status string,
  entry_normal_cbill_order_cnt_30d bigint,
  entry_city_name string, entry_city_fenkuang string,
  entry_charge_region string,
  entry_source_charge_freq_type string,
  entry_source_charge_duid_role_name_v2_type string,
  post_7d_label_dt string, post_7d_charge_life_cycle string,
  post_7d_charge_freq_type string, post_7d_user_identity_prd string,
  post_7d_charge_active_member_end_time string,
  post_7d_member_status string,
  post_7d_normal_cbill_order_cnt_30d bigint,
  post_7d_city_name string, post_7d_city_fenkuang string,
  post_7d_charge_region string,
  post_7d_source_charge_freq_type string,
  post_7d_source_charge_duid_role_name_v2_type string,
  pre_charge_most_order_city_id bigint,
  entry_charge_most_order_city_id bigint,
  post_7d_charge_most_order_city_id bigint
)
PARTITIONED BY (dt string) STORED AS ORC
LOCATION 'hdfs://DClusterNmg5/user/prod_epower_platform/epower_platform/hive/epower_platform/ads_delivery_coupon_funnel_rebuild_20260923_di';

WITH exp_candidate AS (
  SELECT DISTINCT a.ymd AS entry_dt, b.duid, a.group_name AS group_type
  FROM apollo.pre_flow_data_bak a
  JOIN epub_dw.dim_energy_user b
    ON a.ymd = b.dt AND a.apollo_key = b.uid
  WHERE a.ymd BETWEEN '2026-08-12' AND '2026-08-24'
    AND a.exp = 'zhaohuifugou'
    AND a.group_name IN ('control_group', 'treatment_group')
    AND a.apollo_key > 0 AND b.duid > 0
),
exp_user_day AS (
  SELECT entry_dt, duid,
    CASE WHEN count(DISTINCT group_type) = 1 THEN max(group_type)
         ELSE 'conflict' END AS group_type,
    CASE WHEN count(DISTINCT group_type) = 1 THEN 0 ELSE 1 END
      AS day_group_conflict_flag
  FROM exp_candidate
  GROUP BY entry_dt, duid
),
exp_user_period AS (
  SELECT duid, count(DISTINCT group_type) AS period_group_count
  FROM exp_candidate GROUP BY duid
),
exp_user AS (
  SELECT d.entry_dt, d.duid,
    CASE WHEN d.day_group_conflict_flag = 1 OR p.period_group_count > 1
         THEN 'conflict' ELSE d.group_type END AS group_type,
    CASE WHEN d.day_group_conflict_flag = 1 OR p.period_group_count > 1
         THEN 1 ELSE 0 END AS group_conflict_flag
  FROM exp_user_day d
  JOIN exp_user_period p ON d.duid = p.duid
),
target_raw AS (
  SELECT DISTINCT dt AS entry_dt, duid,
    CASE WHEN last_order_diff_days >= 30 AND last_order_diff_days < 60
           THEN '30-60天'
         WHEN last_order_diff_days >= 60 AND last_order_diff_days < 90
           THEN '60-90天'
         WHEN last_order_diff_days >= 90 AND last_order_diff_days < 180
           THEN '90-180天' END AS activity_cycle
  FROM charge_dw.app_charge_tag_duid_df
  WHERE dt BETWEEN '2026-08-12' AND '2026-08-24'
    AND duid > 0 AND charge_normal_cbill_order_cnt_std >= 1
    AND last_order_diff_days >= 30 AND last_order_diff_days < 180
    AND (duid_role_name_v2_type_hg IN ('私家车', '泛私家车')
         OR duid_role_name_v2_hg IN ('顺风认证', '顺风拉单'))
),
target_user AS (
  SELECT entry_dt, duid,
    CASE WHEN count(DISTINCT activity_cycle) = 1 THEN max(activity_cycle)
         ELSE 'conflict' END AS activity_cycle,
    CASE WHEN count(DISTINCT activity_cycle) = 1 THEN 0 ELSE 1 END
      AS activity_conflict_flag
  FROM target_raw
  WHERE activity_cycle IS NOT NULL
  GROUP BY entry_dt, duid
),
eligible AS (
  SELECT e.entry_dt, e.duid, e.group_type, e.group_conflict_flag,
         t.activity_cycle, t.activity_conflict_flag
  FROM exp_user e
  JOIN target_user t
    ON e.entry_dt = t.entry_dt AND e.duid = t.duid
),
batch_map AS (
  SELECT '30-60天' AS activity_cycle,
         '6065393250247640683' AS am_batch_id, 1 AS common_batch
  UNION ALL SELECT '30-60天', '6079956535982687601', 0
  UNION ALL SELECT '30-60天', '6086496452879582289', 0
  UNION ALL SELECT '60-90天', '6079957319596115386', 1
  UNION ALL SELECT '60-90天', '6079958048377406471', 0
  UNION ALL SELECT '60-90天', '6086496793033442360', 0
  UNION ALL SELECT '90-180天', '6079958471528154469', 1
  UNION ALL SELECT '90-180天', '6079958744266966376', 0
  UNION ALL SELECT '90-180天', '6086497075637257271', 0
),
coupon_detail AS (
  SELECT DISTINCT c.duid, to_date(c.bind_time) AS coupon_dt,
    b.activity_cycle, CAST(c.am_batch_id AS string) AS am_batch_id
  FROM epub_dw.dwd_pub_mkt_coupon_instance_df c
  JOIN batch_map b ON CAST(c.am_batch_id AS string) = b.am_batch_id
  WHERE c.dt BETWEEN '2026-08-11' AND '${BIZ_DATE_LINE}'
    AND to_date(c.bind_time) BETWEEN '2026-08-12' AND '2026-08-24'
    AND c.duid > 0
),
coupon_counts AS (
  SELECT e.entry_dt, e.duid,
    count(DISTINCT c.am_batch_id) AS actual_coupon_batch_cnt,
    count(DISTINCT CASE
      WHEN b.common_batch = 1 OR e.group_type = 'treatment_group'
      THEN b.am_batch_id END) AS expected_coupon_batch_cnt,
    count(DISTINCT CASE
      WHEN c.am_batch_id IS NOT NULL
       AND (b.common_batch = 1 OR e.group_type = 'treatment_group')
      THEN c.am_batch_id END) AS received_expected_batch_cnt,
    count(DISTINCT CASE
      WHEN c.am_batch_id IS NOT NULL
       AND b.common_batch = 0 AND e.group_type = 'control_group'
      THEN c.am_batch_id END) AS unexpected_batch_cnt
  FROM eligible e
  LEFT JOIN batch_map b ON e.activity_cycle = b.activity_cycle
  LEFT JOIN coupon_detail c
    ON c.duid = e.duid AND c.coupon_dt = e.entry_dt
   AND c.activity_cycle = e.activity_cycle
   AND c.am_batch_id = b.am_batch_id
  GROUP BY e.entry_dt, e.duid
),
valid_order AS (
  SELECT DISTINCT duid, dt AS order_dt
  FROM charge_dw.dwd_charge_trd_order_di
  WHERE dt BETWEEN '2026-08-13' AND '2026-08-31'
    AND duid > 0 AND is_trd = 1
    AND coalesce(is_cbill, 1) = 1
    AND coalesce(is_test, 0) = 0
),
repurchase AS (
  SELECT DISTINCT e.entry_dt, e.duid
  FROM eligible e
  JOIN valid_order o ON o.duid = e.duid
    AND o.order_dt BETWEEN date_add(e.entry_dt, 1)
                       AND date_add(e.entry_dt, 7)
),
pre_tag AS (
  SELECT DISTINCT duid, charge_life_cycle,
    charge_duid_role_name_v2_type, duid_role_name_v2_type_hg,
    charge_is_member_active, charge_active_member_end_time,
    charge_freq_type, normal_cbill_order_cnt_30d,
    charge_most_order_city_id
  FROM charge_dw.app_charge_tag_duid_df
  WHERE dt = '2026-08-11' AND duid > 0
),
entry_tag AS (
  SELECT DISTINCT dt AS entry_dt, duid, charge_life_cycle,
    charge_freq_type, charge_duid_role_name_v2_type,
    duid_role_name_v2_type_hg, charge_is_member_active,
    charge_active_member_end_time, normal_cbill_order_cnt_30d,
    charge_most_order_city_id
  FROM charge_dw.app_charge_tag_duid_df
  WHERE dt BETWEEN '2026-08-12' AND '2026-08-24' AND duid > 0
),
post_7d_tag AS (
  SELECT DISTINCT dt AS label_dt, duid, charge_life_cycle,
    charge_freq_type, charge_duid_role_name_v2_type,
    duid_role_name_v2_type_hg, charge_is_member_active,
    charge_active_member_end_time, normal_cbill_order_cnt_30d,
    charge_most_order_city_id
  FROM charge_dw.app_charge_tag_duid_df
  WHERE dt BETWEEN '2026-08-19' AND '2026-08-31' AND duid > 0
),
city AS (
  SELECT DISTINCT dt AS label_dt, city_id,
    city_name, city_fenkuang, charge_region
  FROM charge_dw.dim_charge_city
  WHERE dt BETWEEN '2026-08-11' AND '2026-08-31'
)
INSERT OVERWRITE TABLE epower_platform.ads_delivery_coupon_funnel_di
PARTITION (dt = '${BIZ_DATE_LINE}')
SELECT
  e.entry_dt, '184765378', e.duid, e.group_type, e.activity_cycle,
  p.charge_life_cycle, p.duid_role_name_v2_type_hg,
  p.duid_role_name_v2_type_hg,
  CAST(p.charge_active_member_end_time AS string),
  CASE WHEN p.charge_is_member_active = 1 THEN '会员'
       WHEN p.charge_is_member_active = 0 THEN '非会员'
       ELSE '状态未知' END,
  CASE WHEN p.normal_cbill_order_cnt_30d = 0 THEN '0'
       WHEN p.normal_cbill_order_cnt_30d BETWEEN 1 AND 9 THEN '1-9'
       WHEN p.normal_cbill_order_cnt_30d BETWEEN 10 AND 19 THEN '10-19'
       WHEN p.normal_cbill_order_cnt_30d BETWEEN 20 AND 29 THEN '20-29'
       WHEN p.normal_cbill_order_cnt_30d >= 30 THEN '>=30'
       ELSE '未知' END,
  p.normal_cbill_order_cnt_30d,
  CASE WHEN p.normal_cbill_order_cnt_30d = 0 THEN '0'
       WHEN p.normal_cbill_order_cnt_30d BETWEEN 1 AND 9 THEN '1-9'
       WHEN p.normal_cbill_order_cnt_30d BETWEEN 10 AND 19 THEN '10-19'
       WHEN p.normal_cbill_order_cnt_30d BETWEEN 20 AND 29 THEN '20-29'
       WHEN p.normal_cbill_order_cnt_30d >= 30 THEN '>=30'
       ELSE '未知' END,
  c.city_name, c.city_fenkuang, c.charge_region,
  1,
  CASE WHEN q.actual_coupon_batch_cnt > 0 THEN 1 ELSE 0 END,
  CASE WHEN e.group_conflict_flag = 1 OR e.activity_conflict_flag = 1
         THEN CAST(NULL AS int)
       WHEN q.expected_coupon_batch_cnt > 0
        AND q.received_expected_batch_cnt = q.expected_coupon_batch_cnt
        AND q.unexpected_batch_cnt = 0 THEN 1 ELSE 0 END,
  CASE WHEN r.duid IS NOT NULL THEN 1 ELSE 0 END,
  CASE WHEN q.actual_coupon_batch_cnt > 0 AND r.duid IS NOT NULL
         THEN 1 ELSE 0 END,
  CASE WHEN e.group_conflict_flag = 1 OR e.activity_conflict_flag = 1
         THEN CAST(NULL AS int)
       WHEN q.expected_coupon_batch_cnt > 0
        AND q.received_expected_batch_cnt = q.expected_coupon_batch_cnt
        AND q.unexpected_batch_cnt = 0 AND r.duid IS NOT NULL
         THEN 1 ELSE 0 END,
  CASE WHEN p.duid IS NOT NULL THEN '2026-08-11'
       ELSE CAST(NULL AS string) END,
  'rule_proxy_not_ditag',
  e.group_conflict_flag, e.activity_conflict_flag,
  q.actual_coupon_batch_cnt,
  CASE WHEN e.group_conflict_flag = 1 OR e.activity_conflict_flag = 1
         THEN CAST(NULL AS bigint)
       ELSE q.expected_coupon_batch_cnt END,
  et.charge_life_cycle,
  CASE WHEN et.normal_cbill_order_cnt_30d = 0 THEN '0'
       WHEN et.normal_cbill_order_cnt_30d BETWEEN 1 AND 9 THEN '1-9'
       WHEN et.normal_cbill_order_cnt_30d BETWEEN 10 AND 19 THEN '10-19'
       WHEN et.normal_cbill_order_cnt_30d BETWEEN 20 AND 29 THEN '20-29'
       WHEN et.normal_cbill_order_cnt_30d >= 30 THEN '>=30'
       ELSE '未知' END,
  p.charge_freq_type, p.charge_duid_role_name_v2_type,
  et.entry_dt, et.duid_role_name_v2_type_hg,
  CAST(et.charge_active_member_end_time AS string),
  CASE WHEN et.charge_is_member_active = 1 THEN '会员'
       WHEN et.charge_is_member_active = 0 THEN '非会员'
       ELSE '状态未知' END,
  et.normal_cbill_order_cnt_30d,
  ec.city_name, ec.city_fenkuang, ec.charge_region,
  et.charge_freq_type, et.charge_duid_role_name_v2_type,
  pt.label_dt, pt.charge_life_cycle,
  CASE WHEN pt.normal_cbill_order_cnt_30d = 0 THEN '0'
       WHEN pt.normal_cbill_order_cnt_30d BETWEEN 1 AND 9 THEN '1-9'
       WHEN pt.normal_cbill_order_cnt_30d BETWEEN 10 AND 19 THEN '10-19'
       WHEN pt.normal_cbill_order_cnt_30d BETWEEN 20 AND 29 THEN '20-29'
       WHEN pt.normal_cbill_order_cnt_30d >= 30 THEN '>=30'
       ELSE '未知' END,
  pt.duid_role_name_v2_type_hg,
  CAST(pt.charge_active_member_end_time AS string),
  CASE WHEN pt.charge_is_member_active = 1 THEN '会员'
       WHEN pt.charge_is_member_active = 0 THEN '非会员'
       ELSE '状态未知' END,
  pt.normal_cbill_order_cnt_30d,
  pc.city_name, pc.city_fenkuang, pc.charge_region,
  pt.charge_freq_type, pt.charge_duid_role_name_v2_type,
  p.charge_most_order_city_id,
  et.charge_most_order_city_id,
  pt.charge_most_order_city_id
FROM eligible e
LEFT JOIN coupon_counts q
  ON e.entry_dt = q.entry_dt AND e.duid = q.duid
LEFT JOIN repurchase r
  ON e.entry_dt = r.entry_dt AND e.duid = r.duid
LEFT JOIN pre_tag p ON e.duid = p.duid
LEFT JOIN entry_tag et
  ON e.entry_dt = et.entry_dt AND e.duid = et.duid
LEFT JOIN post_7d_tag pt
  ON pt.label_dt = CAST(date_add(e.entry_dt, 7) AS string)
 AND e.duid = pt.duid
LEFT JOIN city c
  ON c.label_dt = '2026-08-11'
 AND p.charge_most_order_city_id = c.city_id
LEFT JOIN city ec
  ON ec.label_dt = e.entry_dt
 AND et.charge_most_order_city_id = ec.city_id
LEFT JOIN city pc
  ON pc.label_dt = pt.label_dt
 AND pt.charge_most_order_city_id = pc.city_id;

-- 试跑质量报告：冲突人数若非零，禁止将此分区切入正式 API。
SELECT
  count(*) AS rows_written,
  count(DISTINCT concat(entry_dt, '#', CAST(duid AS string))) AS duid_days,
  sum(group_conflict_flag) AS group_conflict_rows,
  sum(activity_conflict_flag) AS activity_conflict_rows,
  sum(CASE WHEN is_coupon_repurchase_7d > is_coupon THEN 1 ELSE 0 END)
    AS invalid_coupon_repurchase_rows,
  sum(CASE WHEN is_full_coupon_repurchase_7d > is_full_coupon THEN 1 ELSE 0 END)
    AS invalid_full_coupon_repurchase_rows,
  sum(CASE WHEN label_dt IS NULL THEN 1 ELSE 0 END)
    AS missing_pre_tag_rows,
  sum(CASE WHEN label_dt IS NOT NULL AND charge_life_cycle IS NULL
           THEN 1 ELSE 0 END) AS missing_pre_lifecycle_rows,
  sum(CASE WHEN entry_label_dt IS NULL THEN 1 ELSE 0 END)
    AS missing_entry_tag_rows,
  sum(CASE WHEN post_7d_label_dt IS NULL THEN 1 ELSE 0 END)
    AS missing_post_7d_tag_rows,
  sum(CASE WHEN city_name IS NULL THEN 1 ELSE 0 END)
    AS missing_pre_city_rows,
  sum(CASE WHEN entry_city_name IS NULL THEN 1 ELSE 0 END)
    AS missing_entry_city_rows,
  sum(CASE WHEN post_7d_city_name IS NULL THEN 1 ELSE 0 END)
    AS missing_post_7d_city_rows
FROM epower_platform.ads_delivery_coupon_funnel_di
WHERE dt = '${BIZ_DATE_LINE}';

SELECT assert_true(count(*) > 0, 'recall output empty')
FROM epower_platform.ads_delivery_coupon_funnel_di
WHERE dt = '${BIZ_DATE_LINE}';

-- 实验指标分子和分母：仅 group_type 非 conflict 的行可用于组间比较。
SELECT activity_cycle, group_type,
  count(*) AS entry_users,
  sum(is_coupon) AS coupon_users,
  sum(is_full_coupon) AS full_coupon_users,
  sum(is_coupon_repurchase_7d) AS coupon_repurchase_users,
  sum(is_full_coupon_repurchase_7d) AS full_coupon_repurchase_users,
  sum(is_repurchase_7d) AS all_repurchase_users
FROM epower_platform.ads_delivery_coupon_funnel_di
WHERE dt = '${BIZ_DATE_LINE}'
GROUP BY activity_cycle, group_type
ORDER BY activity_cycle, group_type;
