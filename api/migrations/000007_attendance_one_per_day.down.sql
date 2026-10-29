-- Back to two marks per day: each day's mark becomes both halves.
ALTER TABLE attendance DROP CONSTRAINT attendance_pkey;
ALTER TABLE attendance ADD COLUMN half smallint NOT NULL DEFAULT 1;
INSERT INTO attendance (niat_id, date, half, status, updated_at, updated_by)
SELECT niat_id, date, 2, status, updated_at, updated_by FROM attendance;
ALTER TABLE attendance ALTER COLUMN half DROP DEFAULT;
ALTER TABLE attendance ADD CONSTRAINT attendance_half_check CHECK (half IN (1, 2));
ALTER TABLE attendance ADD CONSTRAINT attendance_pkey PRIMARY KEY (niat_id, date, half);
