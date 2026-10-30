-- One admin remark per student per month, shown with the placement caution.
-- month is the first day of the month.
CREATE TABLE student_remarks (
    niat_id    text        NOT NULL REFERENCES students (niat_id) ON DELETE CASCADE,
    month      date        NOT NULL CHECK (extract(day FROM month) = 1),
    remark     text        NOT NULL CHECK (remark <> '' AND length(remark) <= 500),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by bigint      REFERENCES admins (id) ON DELETE SET NULL,
    PRIMARY KEY (niat_id, month)
);
