-- name: InsertStudentIfMissing :execrows
-- Seed only: never overwrites an existing student.
INSERT INTO students (niat_id, full_name, degree_code, section, level, hall_no, poc_id, coach_id, joined_on)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (niat_id) DO NOTHING;

-- name: SearchActiveStudentsByName :many
-- Public name search. Returns no NIAT IDs.
SELECT full_name, degree_code, section
FROM students
WHERE status = 'active'
  AND lower(full_name) LIKE '%' || lower(sqlc.arg(pattern)::text) || '%' ESCAPE '\'
ORDER BY similarity(lower(full_name), lower(sqlc.arg(query)::text)) DESC, full_name
LIMIT 20;

-- name: GetStudent :one
SELECT s.*, poc.name AS poc_name, coach.name AS coach_name
FROM students s
LEFT JOIN mentors poc ON poc.id = s.poc_id
LEFT JOIN mentors coach ON coach.id = s.coach_id
WHERE s.niat_id = $1;

-- name: ListStudentsForAdmin :many
-- q matches part of the name or the start of the NIAT ID; empty filters match all.
-- hall: NULL matches all; '' matches students with no hall.
SELECT s.*, poc.name AS poc_name, coach.name AS coach_name
FROM students s
LEFT JOIN mentors poc ON poc.id = s.poc_id
LEFT JOIN mentors coach ON coach.id = s.coach_id
WHERE (sqlc.arg(pattern)::text = ''
       OR lower(s.full_name) LIKE '%' || lower(sqlc.arg(pattern)::text) || '%' ESCAPE '\'
       OR s.niat_id LIKE upper(sqlc.arg(pattern)::text) || '%' ESCAPE '\')
  AND (sqlc.arg(degree)::text = '' OR s.degree_code = sqlc.arg(degree)::text)
  AND (sqlc.arg(section)::text = '' OR s.section = sqlc.arg(section)::text)
  AND (sqlc.narg(hall)::text IS NULL OR coalesce(s.hall_no, '') = sqlc.narg(hall)::text)
ORDER BY s.degree_code, s.section, s.full_name;

-- name: ListHalls :many
-- Active students per hall; '' is students with no hall.
SELECT coalesce(hall_no, '')::text AS hall, count(*) AS students
FROM students
WHERE status = 'active'
GROUP BY 1
ORDER BY 1;

-- name: ListSections :many
SELECT DISTINCT degree_code, section FROM students ORDER BY degree_code, section;

-- name: ListActiveStudentsInSection :many
SELECT * FROM students
WHERE degree_code = $1 AND section = $2 AND status = 'active'
ORDER BY full_name;

-- name: GetStudentsByIDs :many
SELECT * FROM students WHERE niat_id = ANY(sqlc.arg(niat_ids)::text[]);

-- name: DeleteDemoStudents :execrows
DELETE FROM students WHERE niat_id LIKE 'N99%';

-- name: UpsertStudentFromImport :exec
-- Student import: insert new IDs, update existing ones. NULL optional values
-- (blank cells) keep what is stored; required fields always overwrite.
INSERT INTO students (niat_id, full_name, degree_code, section, level, hall_no, poc_id, joined_on)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (niat_id) DO UPDATE SET
    full_name   = EXCLUDED.full_name,
    degree_code = EXCLUDED.degree_code,
    section     = EXCLUDED.section,
    level       = COALESCE(EXCLUDED.level, students.level),
    hall_no     = COALESCE(EXCLUDED.hall_no, students.hall_no),
    poc_id      = COALESCE(EXCLUDED.poc_id, students.poc_id),
    joined_on   = COALESCE(EXCLUDED.joined_on, students.joined_on),
    updated_at  = now();

-- name: CreateStudent :one
-- Admin form: add one student. Returns no row when the NIAT ID already exists.
INSERT INTO students (niat_id, full_name, degree_code, section, level, hall_no, poc_id, coach_id, status, joined_on, dropped_on)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
ON CONFLICT (niat_id) DO NOTHING
RETURNING *;

-- name: UpdateStudent :one
-- Admin form: replace every editable field of one student (not the NIAT ID).
UPDATE students
SET full_name = $2, degree_code = $3, section = $4, level = $5, hall_no = $6,
    poc_id = $7, coach_id = $8, status = $9, joined_on = $10, dropped_on = $11, updated_at = now()
WHERE niat_id = $1
RETURNING *;

-- name: DeleteStudent :execrows
-- Permanent: the student's attendance marks are deleted with them (ON DELETE CASCADE).
DELETE FROM students WHERE niat_id = $1;

-- name: CountStudentMarks :one
SELECT count(*) FROM attendance WHERE niat_id = $1;
