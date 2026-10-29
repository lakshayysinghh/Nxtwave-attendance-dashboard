-- name: InsertDegreeIfMissing :exec
INSERT INTO degrees (code, name) VALUES ($1, $2) ON CONFLICT (code) DO NOTHING;

-- name: ListDegrees :many
SELECT * FROM degrees ORDER BY code;

-- name: InsertTermIfMissing :exec
-- Seed only: adds the term unless one with the same name exists.
INSERT INTO terms (name, start_date, end_date, is_current)
SELECT sqlc.arg(name)::text, sqlc.arg(start_date)::date, sqlc.arg(end_date)::date, sqlc.arg(is_current)::boolean
WHERE NOT EXISTS (SELECT 1 FROM terms WHERE name = sqlc.arg(name)::text);

-- name: ListTerms :many
SELECT * FROM terms ORDER BY start_date;

-- name: InsertCalendarDayIfMissing :exec
INSERT INTO calendar_days (date, applies_to, day_type, counts, label)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (date, applies_to) DO NOTHING;

-- name: ListCalendarDays :many
SELECT * FROM calendar_days
WHERE date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
ORDER BY date, applies_to;

-- name: InsertMentorIfMissing :exec
INSERT INTO mentors (name, kind) VALUES ($1, $2)
ON CONFLICT (kind, lower(name)) DO NOTHING;

-- name: GetMentorByName :one
SELECT * FROM mentors WHERE kind = $1 AND lower(name) = lower(sqlc.arg(name)::text);
