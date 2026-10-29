-- name: ListMarks :many
SELECT niat_id, date, half, status FROM attendance
WHERE niat_id = ANY(sqlc.arg(niat_ids)::text[])
  AND date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
ORDER BY niat_id, date, half;

-- name: InsertMarksIfMissing :execrows
-- Seed only: keeps any mark that already exists.
INSERT INTO attendance (niat_id, date, half, status)
SELECT unnest(sqlc.arg(niat_ids)::text[]), unnest(sqlc.arg(dates)::date[]),
       unnest(sqlc.arg(halves)::smallint[]), unnest(sqlc.arg(statuses)::text[])
ON CONFLICT (niat_id, date, half) DO NOTHING;

-- name: UpsertMarks :execrows
INSERT INTO attendance (niat_id, date, half, status, updated_at, updated_by)
SELECT unnest(sqlc.arg(niat_ids)::text[]), unnest(sqlc.arg(dates)::date[]),
       unnest(sqlc.arg(halves)::smallint[]), unnest(sqlc.arg(statuses)::text[]),
       now(), sqlc.arg(updated_by)::bigint
ON CONFLICT (niat_id, date, half) DO UPDATE
SET status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by;

-- name: DeleteMarks :execrows
DELETE FROM attendance a
USING (SELECT unnest(sqlc.arg(niat_ids)::text[]) AS niat_id,
              unnest(sqlc.arg(dates)::date[]) AS date,
              unnest(sqlc.arg(halves)::smallint[]) AS half) d
WHERE a.niat_id = d.niat_id AND a.date = d.date AND a.half = d.half;

-- name: DeleteDemoMarks :execrows
DELETE FROM attendance WHERE niat_id LIKE 'N99%';
