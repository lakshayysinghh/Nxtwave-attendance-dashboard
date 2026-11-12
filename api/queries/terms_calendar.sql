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

-- name: UpsertCalendarRange :many
-- Saves every date in the range, recording the source, batch and admin. A
-- date whose type, counts and label are already the same is left untouched
-- (its times and source stay) and not returned. Returns each inserted or
-- changed date; inserted is false for a changed one.
INSERT INTO calendar_days (date, applies_to, day_type, counts, label, source, batch_id, created_at, created_by, updated_at, updated_by)
SELECT d::date, sqlc.arg(applies_to)::text, sqlc.arg(day_type)::text, sqlc.arg(counts)::boolean, sqlc.arg(label)::text,
       sqlc.arg(source)::text, sqlc.narg(batch_id)::bigint, now(), sqlc.narg(admin_id)::bigint, now(), sqlc.narg(admin_id)::bigint
FROM generate_series(sqlc.arg(from_date)::date, sqlc.arg(to_date)::date, interval '1 day') AS d
WHERE NOT (sqlc.arg(skip_sundays)::boolean AND extract(dow FROM d) = 0)
ON CONFLICT (date, applies_to) DO UPDATE
SET day_type = EXCLUDED.day_type, counts = EXCLUDED.counts, label = EXCLUDED.label,
    source = EXCLUDED.source, batch_id = EXCLUDED.batch_id, updated_at = now(), updated_by = EXCLUDED.updated_by
WHERE (calendar_days.day_type, calendar_days.counts, calendar_days.label) IS DISTINCT FROM (EXCLUDED.day_type, EXCLUDED.counts, EXCLUDED.label)
RETURNING date, (xmax = 0)::boolean AS inserted;

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

-- name: ListCalendarEntries :many
-- Every calendar entry with where it came from. Batch and admin details are
-- NULL for legacy entries, and for an admin account that was deleted.
SELECT c.date, c.applies_to, c.day_type, c.counts, c.label, c.source, c.batch_id,
       c.created_at, c.updated_at, c.created_by, c.updated_by,
       b.file_name AS batch_file_name, b.kind AS batch_kind,
       ca.name AS created_by_name, ca.email AS created_by_email,
       ua.name AS updated_by_name, ua.email AS updated_by_email
FROM calendar_days c
LEFT JOIN import_batches b ON b.id = c.batch_id
LEFT JOIN admins ca ON ca.id = c.created_by
LEFT JOIN admins ua ON ua.id = c.updated_by
ORDER BY c.applies_to, c.date;
