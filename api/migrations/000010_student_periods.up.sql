-- Attendance categories and the periods they belong to.
--
-- A mark's category says why it was set: NULL for a regular mark,
-- INTERNSHIP (always Present) or REGISTRATION_PENDING (always Absent).
-- The status and the one-mark-per-day key are unchanged, so percentages
-- are computed exactly as before.
ALTER TABLE attendance
    ADD COLUMN category text
    CHECK (category IN ('INTERNSHIP', 'REGISTRATION_PENDING'));

-- One internship or registration-pending period of a student. end_date is
-- the last day of the period that is known: an internship's last day, or the
-- last pending day seen in an imported sheet. completed_on is the first day
-- an import showed registration as done; NULL while still pending. Cancelled
-- periods are kept for history.
CREATE TABLE student_periods (
    id           bigserial   PRIMARY KEY,
    niat_id      text        NOT NULL REFERENCES students (niat_id) ON DELETE CASCADE,
    kind         text        NOT NULL CHECK (kind IN ('INTERNSHIP', 'REGISTRATION_PENDING')),
    start_date   date        NOT NULL,
    end_date     date        NOT NULL,
    completed_on date,
    source       text        NOT NULL CHECK (source IN ('admin', 'import')),
    cancelled_at timestamptz,
    cancelled_by bigint      REFERENCES admins (id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    created_by   bigint      REFERENCES admins (id) ON DELETE SET NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   bigint      REFERENCES admins (id) ON DELETE SET NULL,
    CONSTRAINT student_periods_range CHECK (end_date >= start_date),
    CONSTRAINT student_periods_completed CHECK (completed_on IS NULL OR (kind = 'REGISTRATION_PENDING' AND completed_on > end_date))
);
CREATE INDEX student_periods_student ON student_periods (niat_id, kind, start_date);
CREATE INDEX student_periods_dates ON student_periods (kind, start_date, end_date) WHERE cancelled_at IS NULL;
