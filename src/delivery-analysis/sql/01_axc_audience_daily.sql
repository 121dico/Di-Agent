--SPARK_SQL
-- 安心充每日画像。BIZ_DATE_LINE 是来源快照日；本表不代表召回活动的 Ditag 包。
-- 首次重建前先单独运行 00_reset_original_tables.sql；本脚本按业务日覆盖单日分区。
SELECT assert_true(count(*) > 0, 'tag partition empty')
FROM charge_dw.app_charge_tag_duid_df WHERE dt = '${BIZ_DATE_LINE}';

SELECT assert_true(count(*) > 0, 'axc partition empty')
FROM charge_dw.app_charge_axc_dashou_duid_df
WHERE dt = '${BIZ_DATE_LINE}' AND a_type = 1;

SELECT assert_true(count(*) > 0, 'city partition empty')
FROM charge_dw.dim_charge_city WHERE dt = '${BIZ_DATE_LINE}';

-- 同日同一 DUID 有相互矛盾的标签时停止，而不是按列 max() 拼接画像。
SELECT assert_true(count(*) = 0, 'conflicting tag rows')
FROM (
  SELECT duid FROM (
    SELECT DISTINCT duid, charge_life_cycle, charge_freq_type,
      charge_duid_role_name_v2_type, duid_role_name_v2_type_hg,
      charge_is_member_active, charge_active_member_end_time,
      charge_most_order_city_id, axc_buy_status,
      normal_cbill_order_cnt_30d
    FROM charge_dw.app_charge_tag_duid_df
    WHERE dt = '${BIZ_DATE_LINE}' AND duid > 0
      AND axc_freq_type = '低频购买用户'
  ) t GROUP BY duid HAVING count(*) > 1
) bad;

SELECT assert_true(count(*) = 0, 'conflicting axc rows')
FROM (
  SELECT duid FROM (
    SELECT DISTINCT duid, ds_ord_cnt_30d, chg_ord_cnt_30d,
      ds_freq_type, first_dashou_order_id, first_create_date,
      last_dashou_order_id, last_create_date
    FROM charge_dw.app_charge_axc_dashou_duid_df
    WHERE dt = '${BIZ_DATE_LINE}' AND duid > 0 AND a_type = 1
  ) x GROUP BY duid HAVING count(*) > 1
) bad;

SELECT assert_true(count(*) = 0, 'conflicting city rows')
FROM (
  SELECT city_id FROM (
    SELECT DISTINCT city_id, city_name, city_fenkuang, charge_region
    FROM charge_dw.dim_charge_city
    WHERE dt = '${BIZ_DATE_LINE}'
  ) c GROUP BY city_id HAVING count(*) > 1
) bad;

CREATE EXTERNAL TABLE IF NOT EXISTS epower_platform.ads_delivery_audience_snapshot_di (
  duid bigint, crowd_id string, group_type string,
  charge_life_cycle string, charge_freq_type string,
  charge_duid_role_name_v2_type string, user_identity_prd string,
  charge_is_member_active bigint, charge_active_member_end_time string,
  member_status string, charge_most_order_city_id bigint,
  city_name string, city_fenkuang string, charge_region string,
  axc_ord_cnt_30d bigint, chg_ord_cnt_30d bigint,
  ds_freq_type string, axc_buy_status string,
  first_axc_order_id string, first_axc_date string,
  last_axc_order_id string, last_axc_date string,
  normal_cbill_order_cnt_30d bigint, charge_freq_prd_bucket string,
  source_charge_freq_type string,
  source_charge_duid_role_name_v2_type string
)
PARTITIONED BY (dt string) STORED AS ORC
LOCATION 'hdfs://DClusterNmg5/user/prod_epower_platform/epower_platform/hive/epower_platform/ads_delivery_audience_snapshot_rebuild_20260923_di';

WITH tag AS (
  SELECT DISTINCT duid, charge_life_cycle, charge_freq_type,
    charge_duid_role_name_v2_type, duid_role_name_v2_type_hg,
    charge_is_member_active, charge_active_member_end_time,
    charge_most_order_city_id, axc_buy_status,
    normal_cbill_order_cnt_30d
  FROM charge_dw.app_charge_tag_duid_df
  WHERE dt = '${BIZ_DATE_LINE}' AND duid > 0
    AND axc_freq_type = '低频购买用户'
),
axc AS (
  SELECT DISTINCT duid, ds_ord_cnt_30d, chg_ord_cnt_30d,
    ds_freq_type, first_dashou_order_id, first_create_date,
    last_dashou_order_id, last_create_date
  FROM charge_dw.app_charge_axc_dashou_duid_df
  WHERE dt = '${BIZ_DATE_LINE}' AND duid > 0 AND a_type = 1
),
city AS (
  SELECT DISTINCT city_id, city_name, city_fenkuang, charge_region
  FROM charge_dw.dim_charge_city WHERE dt = '${BIZ_DATE_LINE}'
)
INSERT OVERWRITE TABLE epower_platform.ads_delivery_audience_snapshot_di
PARTITION (dt = '${BIZ_DATE_LINE}')
SELECT
  t.duid, 'crowd_axc_low_freq', 'unassigned',
  t.charge_life_cycle,
  CASE WHEN t.normal_cbill_order_cnt_30d = 0 THEN '0'
       WHEN t.normal_cbill_order_cnt_30d BETWEEN 1 AND 9 THEN '1-9'
       WHEN t.normal_cbill_order_cnt_30d BETWEEN 10 AND 19 THEN '10-19'
       WHEN t.normal_cbill_order_cnt_30d BETWEEN 20 AND 29 THEN '20-29'
       WHEN t.normal_cbill_order_cnt_30d >= 30 THEN '>=30'
       ELSE '未知' END,
  t.duid_role_name_v2_type_hg, t.duid_role_name_v2_type_hg,
  t.charge_is_member_active, CAST(t.charge_active_member_end_time AS string),
  CASE WHEN t.charge_is_member_active = 1 THEN '会员'
       WHEN t.charge_is_member_active = 0 THEN '非会员'
       ELSE '状态未知' END,
  t.charge_most_order_city_id,
  c.city_name, c.city_fenkuang, c.charge_region,
  a.ds_ord_cnt_30d, a.chg_ord_cnt_30d,
  a.ds_freq_type, t.axc_buy_status,
  a.first_dashou_order_id, a.first_create_date,
  a.last_dashou_order_id, a.last_create_date,
  t.normal_cbill_order_cnt_30d,
  CASE WHEN t.normal_cbill_order_cnt_30d = 0 THEN '0'
       WHEN t.normal_cbill_order_cnt_30d BETWEEN 1 AND 9 THEN '1-9'
       WHEN t.normal_cbill_order_cnt_30d BETWEEN 10 AND 19 THEN '10-19'
       WHEN t.normal_cbill_order_cnt_30d BETWEEN 20 AND 29 THEN '20-29'
       WHEN t.normal_cbill_order_cnt_30d >= 30 THEN '>=30'
       ELSE '未知' END,
  t.charge_freq_type, t.charge_duid_role_name_v2_type
FROM tag t
LEFT JOIN axc a ON t.duid = a.duid
LEFT JOIN city c ON t.charge_most_order_city_id = c.city_id;

SELECT assert_true(count(*) > 0 AND count(*) = count(DISTINCT duid),
  'audience output empty or duplicate')
FROM epower_platform.ads_delivery_audience_snapshot_di
WHERE dt = '${BIZ_DATE_LINE}';

-- 当天可展示多少真实画像/订单来源；空值保留，不把未关联到的用户算成 0。
SELECT count(*) AS audience_users,
  count(user_identity_prd) AS identity_covered_users,
  count(normal_cbill_order_cnt_30d) AS frequency_covered_users,
  count(charge_active_member_end_time) AS member_end_covered_users,
  count(axc_ord_cnt_30d) AS axc_order_covered_users,
  count(chg_ord_cnt_30d) AS charge_order_covered_users,
  count(city_name) AS city_covered_users
FROM epower_platform.ads_delivery_audience_snapshot_di
WHERE dt = '${BIZ_DATE_LINE}' AND crowd_id = 'crowd_axc_low_freq';
