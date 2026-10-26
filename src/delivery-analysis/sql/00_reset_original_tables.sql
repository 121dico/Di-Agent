--SPARK_SQL
-- 一次性重建入口：先运行 00_recall_source_preflight.sql，确认来源字段和分区。
-- 用户已确认允许旧投放分析表断数；本脚本只删除三张原表的 Hive 元数据。
-- 原表为 EXTERNAL，DROP 不保证删除旧 HDFS 文件；新建表改用独立的 rebuild_20260923 路径。
-- 只在首次重建时执行一次。日常调度仅运行 01/02，不能重复运行本脚本。
DROP TABLE IF EXISTS epower_platform.ads_delivery_user_effect_di;
DROP TABLE IF EXISTS epower_platform.ads_delivery_coupon_funnel_di;
DROP TABLE IF EXISTS epower_platform.ads_delivery_audience_snapshot_di;
