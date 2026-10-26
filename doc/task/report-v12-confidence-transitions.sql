-- 新增有订单用户：按用户确认的相邻日标签转换口径，不称历史首单。
-- 本文件是待上游执行的 Spark SQL 查询方案，尚未部署、未写入线上表。
-- biz_date 格式 yyyy-MM-dd。执行前必须确认当天和前一天分区均完整就绪。
-- 缺失任一分区应中止，不得把缺失分区当成空人群；重跑后覆盖对应日期聚合。
-- 必须先跨全部城市匹配 DUID，再按当天城市统计，避免迁城用户误计为新增。
WITH paired AS (
  SELECT
    duid,
    MAX(CASE WHEN dt = '${biz_date}' THEN 1 ELSE 0 END) AS present_today,
    MAX(CASE WHEN dt = CAST(DATE_SUB(TO_DATE('${biz_date}'), 1) AS STRING)
      THEN 1 ELSE 0 END) AS present_previous,
    MAX(CASE WHEN dt = '${biz_date}' THEN ps_conf END) AS confidence_today,
    MAX(CASE WHEN dt = CAST(DATE_SUB(TO_DATE('${biz_date}'), 1) AS STRING)
      THEN ps_conf END) AS confidence_previous,
    MAX(CASE WHEN dt = '${biz_date}' THEN city_id END) AS current_city_id
  FROM epower_platform.price_sensitive_v1_2
  WHERE dt IN ('${biz_date}', CAST(DATE_SUB(TO_DATE('${biz_date}'), 1) AS STRING))
    AND duid IS NOT NULL
  GROUP BY duid
)
SELECT
  '${biz_date}' AS dt,
  current_city_id AS city_id,
  SUM(CASE WHEN present_previous = 1 AND confidence_previous = 0
    AND confidence_today > 0 THEN 1 ELSE 0 END) AS activated_order_user_count,
  SUM(CASE WHEN present_previous = 0 AND confidence_today > 0
    THEN 1 ELSE 0 END) AS new_entry_order_user_count,
  SUM(CASE WHEN present_previous = 0
    THEN 1 ELSE 0 END) AS new_entry_user_count,
  SUM(CASE WHEN confidence_today > 0
    AND (present_previous = 0 OR confidence_previous = 0)
    THEN 1 ELSE 0 END) AS new_order_user_count
FROM paired
WHERE present_today = 1
GROUP BY current_city_id;

-- activated_order_user_count 与 new_entry_order_user_count 互斥，可以相加。
-- new_entry_order_user_count 是 new_entry_user_count 的子集，不要再次相加。
-- 昨日存在但 ps_conf 为 NULL 的用户不视为置信度 0，避免未知数据冒充首次转换。
-- 此查询依赖源表 (dt, duid) 唯一契约；冲突重复行须先治理，不能任取城市/置信度。
