-- name: InsertImportBatch :one
INSERT INTO import_batches (kind, file_name, uploaded_by, status)
VALUES (sqlc.arg(kind)::text, sqlc.arg(file_name)::text, sqlc.narg(uploaded_by)::bigint, 'committed')
RETURNING id;

-- name: SetImportBatchSummary :exec
UPDATE import_batches SET summary = sqlc.arg(summary)::jsonb WHERE id = sqlc.arg(id)::bigint;

-- name: ListImportBatches :many
-- Saved uploads, newest first, with how many calendar entries still point at
-- each one (a later upload or edit moves an entry to its own batch).
SELECT b.id, b.kind, b.file_name, b.status, b.summary, b.created_at,
       a.name AS uploaded_by_name, a.email AS uploaded_by_email,
       (SELECT count(*) FROM calendar_days c WHERE c.batch_id = b.id) AS current_entries
FROM import_batches b
LEFT JOIN admins a ON a.id = b.uploaded_by
WHERE b.status = 'committed'
ORDER BY b.created_at DESC, b.id DESC;
