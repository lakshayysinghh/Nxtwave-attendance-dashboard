-- One attendance mark per day instead of first half / second half.
-- Where a day has both halves, the first half's mark is kept; a day with
-- only a second-half mark keeps that one.
DELETE FROM attendance a
USING attendance b
WHERE a.niat_id = b.niat_id AND a.date = b.date AND a.half = 2 AND b.half = 1;

ALTER TABLE attendance DROP CONSTRAINT attendance_pkey;
ALTER TABLE attendance DROP CONSTRAINT attendance_half_check;
ALTER TABLE attendance DROP COLUMN half;
ALTER TABLE attendance ADD CONSTRAINT attendance_pkey PRIMARY KEY (niat_id, date);
