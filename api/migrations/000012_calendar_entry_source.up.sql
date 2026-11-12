-- Where each calendar entry came from, and when and by whom it was saved.
-- Entries saved before this migration keep source 'legacy' with no times or
-- authors: that information was never recorded and is not guessed.
ALTER TABLE calendar_days
    ADD COLUMN source     text   NOT NULL DEFAULT 'legacy'
        CHECK (source IN ('legacy', 'manual', 'calendar_import', 'attendance_import', 'students_import')),
    ADD COLUMN batch_id   bigint REFERENCES import_batches (id) ON DELETE SET NULL,
    ADD COLUMN created_at timestamptz,
    ADD COLUMN created_by bigint REFERENCES admins (id) ON DELETE SET NULL,
    ADD COLUMN updated_at timestamptz,
    ADD COLUMN updated_by bigint REFERENCES admins (id) ON DELETE SET NULL;

CREATE INDEX calendar_days_batch_id ON calendar_days (batch_id) WHERE batch_id IS NOT NULL;
