-- Back to one mark per day. Second-half marks cannot fit the old key, so they
-- are removed; First-half marks are kept as the day's mark.
DELETE FROM attendance WHERE half = 2;

ALTER TABLE attendance DROP CONSTRAINT attendance_pkey;
ALTER TABLE attendance ADD CONSTRAINT attendance_pkey PRIMARY KEY (niat_id, date);

ALTER TABLE attendance DROP CONSTRAINT attendance_half_check;
ALTER TABLE attendance DROP COLUMN half;
