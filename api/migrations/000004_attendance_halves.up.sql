-- MVP: two marks per counted day, First half (1) and Second half (2).
-- Additive: existing rows (if any) become First half; nothing is dropped.
ALTER TABLE attendance ADD COLUMN half smallint NOT NULL DEFAULT 1;
ALTER TABLE attendance ADD CONSTRAINT attendance_half_check CHECK (half IN (1, 2));
ALTER TABLE attendance ALTER COLUMN half DROP DEFAULT;

ALTER TABLE attendance DROP CONSTRAINT attendance_pkey;
ALTER TABLE attendance ADD CONSTRAINT attendance_pkey PRIMARY KEY (niat_id, date, half);
