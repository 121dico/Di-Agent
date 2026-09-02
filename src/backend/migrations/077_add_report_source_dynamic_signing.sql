ALTER TABLE report_data_sources
    ADD COLUMN IF NOT EXISTS app_secret_env VARCHAR(160) NOT NULL DEFAULT '';

UPDATE report_data_sources
SET app_key_env = 'REPORT_PRICE_APP_KEY',
    app_secret_env = 'REPORT_PRICE_APP_SECRET',
    x_date_env = '',
    updated_at = NOW()
WHERE api_name = 'price_sensitive';

---- DOWN
UPDATE report_data_sources
SET app_secret_env = '',
    signature_env = 'REPORT_SCORE_SIGN',
    x_date_env = 'REPORT_SCORE_DATE',
    updated_at = NOW()
WHERE api_name = 'price_sensitive';

ALTER TABLE report_data_sources
    DROP COLUMN IF EXISTS app_secret_env;
