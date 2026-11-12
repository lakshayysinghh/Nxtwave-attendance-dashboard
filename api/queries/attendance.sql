-- name: ListMarks :many
SELECT niat_id, date, status, coalesce(category, '')::text AS category FROM attendance
WHERE niat_id = ANY(sqlc.arg(niat_ids)::text[])
  AND date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
ORDER BY niat_id, date;

-- name: InsertMarksIfMissing :execrows
-- Seed only: keeps any mark that already exists.
INSERT INTO attendance (niat_id, date, status)
SELECT unnest(sqlc.arg(niat_ids)::text[]), unnest(sqlc.arg(dates)::date[]), unnest(sqlc.arg(statuses)::text[])
ON CONFLICT (niat_id, date) DO NOTHING;

-- name: UpsertMarks :execrows
-- categories: '' for a regular mark. A regular mark with the same status as
-- the stored one keeps the stored category, so re-saving a day does not
-- drop its INTERNSHIP or REGISTRATION_PENDING tag; a changed status clears it.
INSERT INTO attendance (niat_id, date, status, category, updated_at, updated_by)
SELECT u.niat_id, u.date, u.status, NULLIF(u.category, ''), now(), sqlc.arg(updated_by)::bigint
FROM (SELECT unnest(sqlc.arg(niat_ids)::text[]) AS niat_id, unnest(sqlc.arg(dates)::date[]) AS date,
             unnest(sqlc.arg(statuses)::text[]) AS status, unnest(sqlc.arg(categories)::text[]) AS category) u
ON CONFLICT (niat_id, date) DO UPDATE
SET category = CASE
        WHEN EXCLUDED.category IS NULL AND attendance.status = EXCLUDED.status THEN attendance.category
        ELSE EXCLUDED.category
    END,
    status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;

-- name: InsertMarksKeepExisting :execrows
-- Adds marks only on days that have none; existing marks are left as they are.
INSERT INTO attendance (niat_id, date, status, category, updated_at, updated_by)
SELECT u.niat_id, u.date, u.status, NULLIF(u.category, ''), now(), sqlc.arg(updated_by)::bigint
FROM (SELECT unnest(sqlc.arg(niat_ids)::text[]) AS niat_id, unnest(sqlc.arg(dates)::date[]) AS date,
             unnest(sqlc.arg(statuses)::text[]) AS status, unnest(sqlc.arg(categories)::text[]) AS category) u
ON CONFLICT (niat_id, date) DO NOTHING;

-- name: DeleteCategoryMarks :execrows
-- Removes one category's marks in a date range; marks of any other category
-- (including regular marks set by hand) stay.
DELETE FROM attendance
WHERE niat_id = sqlc.arg(niat_id) AND category = sqlc.arg(category)::text
  AND date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date;

-- name: DeleteMarks :execrows
DELETE FROM attendance a
USING (SELECT unnest(sqlc.arg(niat_ids)::text[]) AS niat_id,
              unnest(sqlc.arg(dates)::date[]) AS date) d
WHERE a.niat_id = d.niat_id AND a.date = d.date;

-- name: DeleteDemoMarks :execrows
DELETE FROM attendance WHERE niat_id LIKE 'N99%';
