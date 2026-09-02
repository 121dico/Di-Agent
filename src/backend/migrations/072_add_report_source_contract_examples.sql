ALTER TABLE report_data_sources
    ADD COLUMN IF NOT EXISTS response_example TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS hive_ddl TEXT NOT NULL DEFAULT '';

---- DOWN
ALTER TABLE report_data_sources
    DROP COLUMN IF EXISTS hive_ddl,
    DROP COLUMN IF EXISTS response_example;
