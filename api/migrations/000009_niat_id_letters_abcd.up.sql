-- The 7th character of a NIAT ID is a programme letter: A or B (CDU).
-- Every other character keeps its old rule.
UPDATE settings SET value = '"^N\\d{2}H\\d{2}[AB]\\d{4}$"'
WHERE key = 'niat_id_pattern';
