-- name: ListStudentRemarks :many
SELECT month, remark FROM student_remarks WHERE niat_id = $1 ORDER BY month;

-- name: UpsertStudentRemark :exec
INSERT INTO student_remarks (niat_id, month, remark, updated_by)
VALUES (sqlc.arg(niat_id), sqlc.arg(month), sqlc.arg(remark), sqlc.arg(updated_by)::bigint)
ON CONFLICT (niat_id, month) DO UPDATE
SET remark = EXCLUDED.remark, updated_at = now(), updated_by = EXCLUDED.updated_by;

-- name: DeleteStudentRemark :execrows
DELETE FROM student_remarks WHERE niat_id = $1 AND month = $2;
