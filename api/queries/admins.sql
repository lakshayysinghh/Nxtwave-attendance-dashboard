-- name: GetAdminByEmail :one
SELECT * FROM admins WHERE email = lower(sqlc.arg(email)::text);

-- name: GetAdminByID :one
SELECT * FROM admins WHERE id = $1;

-- name: UpsertOwner :one
-- Makes OWNER_EMAIL an active owner on startup. Never demotes anyone else.
INSERT INTO admins (email, role, active)
VALUES (lower(sqlc.arg(email)::text), 'owner', true)
ON CONFLICT (email) DO UPDATE SET role = 'owner', active = true
RETURNING *;

-- name: SetAdminNameIfEmpty :exec
-- Fills the display name from the Google profile on first sign-in.
UPDATE admins SET name = sqlc.arg(name)::text WHERE id = sqlc.arg(id) AND name = '';
