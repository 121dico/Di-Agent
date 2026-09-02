UPDATE report_data_sources
SET endpoint = 'http://10.88.128.15:8000',
    updated_at = NOW()
WHERE api_name = 'main_station_180d_downstream'
  AND endpoint <> 'http://10.88.128.15:8000';

---- DOWN
UPDATE report_data_sources
SET endpoint = 'http://10.88.128.15:8000/dataservice/gateway/v1/api/main_station_180d_downstream',
    updated_at = NOW()
WHERE api_name = 'main_station_180d_downstream';
