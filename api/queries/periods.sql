-- name: LockStudents :many
-- Serialises period changes per student inside a transaction.
SELECT niat_id FROM students WHERE niat_id = ANY(sqlc.arg(niat_ids)::text[]) ORDER BY niat_id FOR UPDATE;

-- name: ListStudentPeriods :many
-- Every period of one student, cancelled ones included (history).
SELECT * FROM student_periods WHERE niat_id = $1 ORDER BY start_date, id;

-- name: ListActivePeriodsForStudents :many
SELECT * FROM student_periods
WHERE niat_id = ANY(sqlc.arg(niat_ids)::text[]) AND cancelled_at IS NULL
ORDER BY niat_id, kind, start_date;

-- name: ListPeriodsOverlapping :many
-- Not cancelled periods of one kind that touch from..to, with the student.
SELECT p.*, s.full_name, s.degree_code, s.section, s.hall_no
FROM student_periods p
JOIN students s ON s.niat_id = p.niat_id
WHERE p.kind = sqlc.arg(kind)::text AND p.cancelled_at IS NULL
  AND p.start_date <= sqlc.arg(to_date)::date AND p.end_date >= sqlc.arg(from_date)::date
ORDER BY p.start_date, s.full_name;

-- name: GetPeriod :one
SELECT * FROM student_periods WHERE id = $1;

-- name: InsertPeriod :one
INSERT INTO student_periods (niat_id, kind, start_date, end_date, completed_on, source, created_by, updated_by)
VALUES (sqlc.arg(niat_id), sqlc.arg(kind), sqlc.arg(start_date), sqlc.arg(end_date), sqlc.narg(completed_on),
        sqlc.arg(source), sqlc.arg(admin_id)::bigint, sqlc.arg(admin_id)::bigint)
RETURNING *;

-- name: UpdatePeriod :one
UPDATE student_periods
SET start_date = sqlc.arg(start_date), end_date = sqlc.arg(end_date), completed_on = sqlc.narg(completed_on),
    updated_at = now(), updated_by = sqlc.arg(admin_id)::bigint
WHERE id = sqlc.arg(id) AND cancelled_at IS NULL
RETURNING *;

-- name: CancelPeriod :one
UPDATE student_periods
SET cancelled_at = now(), cancelled_by = sqlc.arg(admin_id)::bigint, updated_at = now(), updated_by = sqlc.arg(admin_id)::bigint
WHERE id = sqlc.arg(id) AND cancelled_at IS NULL
RETURNING *;
