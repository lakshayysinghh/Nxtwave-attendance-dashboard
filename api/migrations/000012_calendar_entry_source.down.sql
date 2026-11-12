DROP INDEX IF EXISTS calendar_days_batch_id;
ALTER TABLE calendar_days
    DROP COLUMN updated_by,
    DROP COLUMN updated_at,
    DROP COLUMN created_by,
    DROP COLUMN created_at,
    DROP COLUMN batch_id,
    DROP COLUMN source;
