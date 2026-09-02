ALTER TABLE report_data_sources
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

UPDATE report_data_sources
SET description = '充电用户价敏标签：按 DUID 汇总近 180 天行为，提供价敏得分、等级、类型及 D1-D4 解释指标。',
    updated_at = NOW()
WHERE api_name = 'price_sensitive';

UPDATE report_data_sources
SET description = '近 180 天充电订单明细：按订单粒度提供城市、场站、价格、充电时段及繁忙度等分析字段。',
    updated_at = NOW()
WHERE api_name = 'main_station_180d_downstream';

---- DOWN
ALTER TABLE report_data_sources DROP COLUMN IF EXISTS description;
