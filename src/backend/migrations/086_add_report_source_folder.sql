-- 数据源按业务需求归入文件夹；空字符串表示未分组，历史数据保持兼容。
ALTER TABLE report_data_sources
    ADD COLUMN IF NOT EXISTS folder VARCHAR(80) NOT NULL DEFAULT '';

-- 当前“价敏标签”需求的 4 个接口默认归入同名文件夹，管理员后续可在数据源详情里调整。
UPDATE report_data_sources
SET folder = '价敏标签'
WHERE folder = ''
  AND api_name IN (
      'price_sensitive',
      'price_sensitive_v1_2',
      'station_price_sensitive_test_detail',
      'main_station_180d_downstream'
  );

---- DOWN
ALTER TABLE report_data_sources DROP COLUMN IF EXISTS folder;
