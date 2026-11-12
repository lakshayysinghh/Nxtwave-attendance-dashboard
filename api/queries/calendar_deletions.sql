-- name: ListCalendarEntriesForUpdate :many
-- The same rows as ListCalendarEntries, locked until the transaction ends so
-- a deletion or edit works on exactly what was checked.
SELECT c.date, c.applies_to, c.day_type, c.counts, c.label, c.source, c.batch_id,
       c.created_at, c.updated_at, c.created_by, c.updated_by,
       b.file_name AS batch_file_name, b.kind AS batch_kind,
       ca.name AS created_by_name, ca.email AS created_by_email,
       ua.name AS updated_by_name, ua.email AS updated_by_email
FROM calendar_days c
LEFT JOIN import_batches b ON b.id = c.batch_id
LEFT JOIN admins ca ON ca.id = c.created_by
LEFT JOIN admins ua ON ua.id = c.updated_by
ORDER BY c.applies_to, c.date
FOR UPDATE OF c;

-- name: InsertCalendarDeletion :one
INSERT INTO calendar_deletions (kind, criteria, entry_count, deleted_by, deleted_by_email)
VALUES (sqlc.arg(kind)::text, sqlc.arg(criteria)::jsonb, sqlc.arg(entry_count)::integer, sqlc.narg(deleted_by)::bigint, sqlc.arg(deleted_by_email)::text)
RETURNING id, deleted_at;

-- name: ArchiveCalendarEntries :execrows
-- Copies the given (date, applies_to) entries, with every detail, into the deletion.
INSERT INTO calendar_deleted_entries (deletion_id, date, applies_to, day_type, counts, label, source, batch_id, created_at, created_by, updated_at, updated_by)
SELECT sqlc.arg(deletion_id)::bigint, c.date, c.applies_to, c.day_type, c.counts, c.label, c.source, c.batch_id, c.created_at, c.created_by, c.updated_at, c.updated_by
FROM calendar_days c
JOIN (SELECT unnest(sqlc.arg(dates)::date[]) AS date, unnest(sqlc.arg(applies_to)::text[]) AS applies_to) k
  ON k.date = c.date AND k.applies_to = c.applies_to;

-- name: DeleteCalendarEntriesByKeys :execrows
DELETE FROM calendar_days c
USING (SELECT unnest(sqlc.arg(dates)::date[]) AS date, unnest(sqlc.arg(applies_to)::text[]) AS applies_to) k
WHERE k.date = c.date AND k.applies_to = c.applies_to;

-- name: UpdateCalendarEntriesByKeys :execrows
-- An admin's correction: the entries become manual entries (an imported-entry
-- reset will no longer remove them) and the edit is recorded.
UPDATE calendar_days c
SET day_type = sqlc.arg(day_type)::text, counts = sqlc.arg(counts)::boolean, label = sqlc.arg(label)::text,
    source = 'manual', batch_id = NULL, updated_at = now(), updated_by = sqlc.narg(admin_id)::bigint
FROM (SELECT unnest(sqlc.arg(dates)::date[]) AS date, unnest(sqlc.arg(applies_to)::text[]) AS applies_to) k
WHERE k.date = c.date AND k.applies_to = c.applies_to;

-- name: ListCalendarDeletions :many
SELECT d.id, d.kind, d.criteria, d.entry_count, d.deleted_by_email, d.deleted_at, d.restored_at,
       a.name AS deleted_by_name, r.name AS restored_by_name, r.email AS restored_by_email,
       (SELECT count(*) FROM calendar_deleted_entries e WHERE e.deletion_id = d.id AND e.restored) AS restored_entries
FROM calendar_deletions d
LEFT JOIN admins a ON a.id = d.deleted_by
LEFT JOIN admins r ON r.id = d.restored_by
ORDER BY d.deleted_at DESC, d.id DESC;

-- name: ListDeletedEntries :many
SELECT e.date, e.applies_to, e.day_type, e.counts, e.label, e.source, e.batch_id, e.restored,
       b.file_name AS batch_file_name
FROM calendar_deleted_entries e
LEFT JOIN import_batches b ON b.id = e.batch_id
WHERE e.deletion_id = sqlc.arg(deletion_id)::bigint
ORDER BY e.applies_to, e.date;

-- name: LockCalendarDeletion :one
SELECT id, kind, restored_at FROM calendar_deletions WHERE id = sqlc.arg(id)::bigint FOR UPDATE;

-- name: RestoreDeletedEntries :many
-- Puts back the deleted entries whose date and scope are still free, with
-- their original details. Entries saved since then on the same date and
-- scope are kept, and those deleted ones stay in the archive.
INSERT INTO calendar_days (date, applies_to, day_type, counts, label, source, batch_id, created_at, created_by, updated_at, updated_by)
SELECT e.date, e.applies_to, e.day_type, e.counts, e.label, e.source, e.batch_id, e.created_at, e.created_by, e.updated_at, e.updated_by
FROM calendar_deleted_entries e
WHERE e.deletion_id = sqlc.arg(deletion_id)::bigint AND NOT e.restored
ON CONFLICT (date, applies_to) DO NOTHING
RETURNING date, applies_to;

-- name: MarkDeletedEntriesRestored :exec
UPDATE calendar_deleted_entries e SET restored = true
FROM (SELECT unnest(sqlc.arg(dates)::date[]) AS date, unnest(sqlc.arg(applies_to)::text[]) AS applies_to) k
WHERE e.deletion_id = sqlc.arg(deletion_id)::bigint AND k.date = e.date AND k.applies_to = e.applies_to;

-- name: SetCalendarDeletionRestored :exec
UPDATE calendar_deletions SET restored_at = now(), restored_by = sqlc.narg(admin_id)::bigint WHERE id = sqlc.arg(id)::bigint;

-- name: CountMarksByDateAndDegree :many
-- Saved marks per date and degree, to explain what a calendar change affects.
SELECT a.date, s.degree_code, count(*) AS marks
FROM attendance a
JOIN students s ON s.niat_id = a.niat_id
WHERE a.date BETWEEN sqlc.arg(from_date)::date AND sqlc.arg(to_date)::date
GROUP BY a.date, s.degree_code
ORDER BY a.date, s.degree_code;
