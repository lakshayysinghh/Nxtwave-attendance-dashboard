-- Recoverable deletion of calendar entries. Deleted rows are copied here with
-- all their details before they leave calendar_days, so a deletion can be
-- reviewed and restored. Attendance marks, students and periods are never
-- touched by a calendar deletion.
CREATE TABLE calendar_deletions (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind             text        NOT NULL CHECK (kind IN ('selected', 'imported')),
    criteria         jsonb       NOT NULL DEFAULT '{}'::jsonb,
    entry_count      integer     NOT NULL,
    deleted_by       bigint      REFERENCES admins (id) ON DELETE SET NULL,
    deleted_by_email text        NOT NULL DEFAULT '',
    deleted_at       timestamptz NOT NULL DEFAULT now(),
    restored_at      timestamptz,
    restored_by      bigint      REFERENCES admins (id) ON DELETE SET NULL
);
CREATE INDEX calendar_deletions_deleted_at ON calendar_deletions (deleted_at DESC);

CREATE TABLE calendar_deleted_entries (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    deletion_id bigint      NOT NULL REFERENCES calendar_deletions (id) ON DELETE CASCADE,
    date        date        NOT NULL,
    applies_to  text        NOT NULL,
    day_type    text        NOT NULL,
    counts      boolean     NOT NULL,
    label       text        NOT NULL,
    source      text        NOT NULL,
    batch_id    bigint      REFERENCES import_batches (id) ON DELETE SET NULL,
    created_at  timestamptz,
    created_by  bigint      REFERENCES admins (id) ON DELETE SET NULL,
    updated_at  timestamptz,
    updated_by  bigint      REFERENCES admins (id) ON DELETE SET NULL,
    restored    boolean     NOT NULL DEFAULT false
);
CREATE INDEX calendar_deleted_entries_deletion ON calendar_deleted_entries (deletion_id);

-- Filters on the Manage entries view.
CREATE INDEX calendar_days_source ON calendar_days (source);
CREATE INDEX calendar_days_updated_at ON calendar_days (updated_at);
