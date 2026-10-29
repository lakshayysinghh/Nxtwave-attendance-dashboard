-- name: GetTerm :one
SELECT * FROM terms WHERE id = $1;

-- name: CreateTerm :one
INSERT INTO terms (name, start_date, end_date) VALUES ($1, $2, $3) RETURNING *;

-- name: UpdateTerm :one
UPDATE terms SET name = $2, start_date = $3, end_date = $4 WHERE id = $1 RETURNING *;

-- name: ClearCurrentTerm :exec
UPDATE terms SET is_current = false WHERE is_current AND id <> $1;

-- name: MarkTermCurrent :one
UPDATE terms SET is_current = true WHERE id = $1 RETURNING *;

-- name: DeleteTerm :execrows
DELETE FROM terms WHERE id = $1;

-- name: CountAttendanceBetween :one
SELECT count(*) FROM attendance
WHERE date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date;

-- name: UpsertCalendarRange :execrows
-- One entry per date in the range (optionally skipping Sundays); an existing
-- entry for the same date and applies_to is replaced.
INSERT INTO calendar_days (date, applies_to, day_type, counts, label)
SELECT d::date, sqlc.arg(applies_to)::text, sqlc.arg(day_type)::text, sqlc.arg(counts)::boolean, sqlc.arg(label)::text
FROM generate_series(sqlc.arg(from_date)::date, sqlc.arg(to_date)::date, interval '1 day') AS d
WHERE NOT (sqlc.arg(skip_sundays)::boolean AND extract(dow FROM d) = 0)
ON CONFLICT (date, applies_to) DO UPDATE
SET day_type = EXCLUDED.day_type, counts = EXCLUDED.counts, label = EXCLUDED.label;

-- name: DeleteCalendarRange :execrows
DELETE FROM calendar_days
WHERE date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
  AND applies_to = sqlc.arg(applies_to)::text;

-- name: CountMarkedDatesForDegree :one
-- Dates in the range that already have marks for students the entry applies to.
SELECT count(DISTINCT a.date) FROM attendance a
JOIN students s ON s.niat_id = a.niat_id
WHERE a.date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
  AND (sqlc.arg(applies_to)::text = 'ALL' OR s.degree_code = sqlc.arg(applies_to)::text);

-- name: ListMarkedDatesByDegree :many
-- Which degrees already have attendance on each date in the range.
SELECT DISTINCT a.date, s.degree_code FROM attendance a
JOIN students s ON s.niat_id = a.niat_id
WHERE a.date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
ORDER BY a.date;
