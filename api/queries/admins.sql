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

-- name: InsertOwnerIfMissing :exec
-- Startup: make sure OWNER_EMAIL exists. Never changes an existing admin
-- (role, status or password), so in-app changes survive restarts.
INSERT INTO admins (email, role, active)
VALUES (lower(sqlc.arg(email)::text), 'owner', true)
ON CONFLICT (email) DO NOTHING;

-- name: SetOwnerPassword :one
-- `server create-owner`: create or promote the configured Owner and set the
-- password. Ends any existing sessions for that admin.
INSERT INTO admins (email, role, active, password_hash)
VALUES (lower(sqlc.arg(email)::text), 'owner', true, sqlc.arg(password_hash)::text)
ON CONFLICT (email) DO UPDATE SET
    role = 'owner', active = true, password_hash = EXCLUDED.password_hash,
    must_change_password = false, session_version = admins.session_version + 1
RETURNING *;

-- name: ListAdmins :many
SELECT * FROM admins ORDER BY role DESC, email;

-- name: CreateAdmin :one
-- Returns no row when the email is already taken.
INSERT INTO admins (email, name, role, active, password_hash, must_change_password)
VALUES (lower(sqlc.arg(email)::text), sqlc.arg(name)::text, 'admin', true, sqlc.arg(password_hash)::text, true)
ON CONFLICT (email) DO NOTHING
RETURNING *;

-- name: SetPasswordByID :one
-- Owner reset (must_change = true) or own change (false). Ends existing sessions.
UPDATE admins
SET password_hash = sqlc.arg(password_hash)::text,
    must_change_password = sqlc.arg(must_change)::boolean,
    session_version = session_version + 1
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: SetPasswordByEmail :one
-- `server set-password EMAIL`: emergency reset from the console.
UPDATE admins
SET password_hash = sqlc.arg(password_hash)::text, must_change_password = false,
    session_version = session_version + 1
WHERE email = lower(sqlc.arg(email)::text)
RETURNING *;

-- name: EndSessions :exec
UPDATE admins SET session_version = session_version + 1 WHERE id = $1;

-- name: LockActiveOwners :many
-- Taken inside a transaction before changing any role or status, so two
-- concurrent changes cannot both remove the last active Owner.
SELECT id FROM admins WHERE role = 'owner' AND active ORDER BY id FOR UPDATE;

-- name: UpdateAdminAccess :one
UPDATE admins
SET active = sqlc.arg(active)::boolean, role = sqlc.arg(role)::text,
    session_version = session_version + CASE WHEN sqlc.arg(active)::boolean THEN 0 ELSE 1 END
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: UpdateAdminProfile :one
-- Owner edit of name and email. A changed email ends that admin's sessions.
-- A taken email fails on the unique constraint.
UPDATE admins
SET name = sqlc.arg(name)::text, email = lower(sqlc.arg(email)::text),
    session_version = session_version + CASE WHEN email = lower(sqlc.arg(email)::text) THEN 0 ELSE 1 END
WHERE id = sqlc.arg(id)
RETURNING *;

-- name: DeleteAdmin :execrows
-- Marks and imports they made keep their values; updated_by and uploaded_by become NULL.
DELETE FROM admins WHERE id = $1;
