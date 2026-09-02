-- The administrator currently supplied a replayable signed request rather
-- than an app secret. Keep the values outside the database and resolve them
-- from the backend's local environment file at runtime.
UPDATE report_data_sources
SET app_key_env = 'REPORT_PRICE_APP_KEY',
    app_secret_env = '',
    signature_env = 'REPORT_PRICE_SIGN',
    x_date_env = 'REPORT_PRICE_SIGN_DATE',
    updated_at = NOW()
WHERE api_name = 'price_sensitive';

---- DOWN
UPDATE report_data_sources
SET app_key_env = 'REPORT_PRICE_APP_KEY',
    app_secret_env = 'REPORT_PRICE_APP_SECRET',
    signature_env = '',
    x_date_env = '',
    updated_at = NOW()
WHERE api_name = 'price_sensitive';
