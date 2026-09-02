ALTER TABLE report_data_sources
    ADD COLUMN IF NOT EXISTS x_date_env VARCHAR(160) NOT NULL DEFAULT '';

---- DOWN
ALTER TABLE report_data_sources DROP COLUMN IF EXISTS x_date_env;
