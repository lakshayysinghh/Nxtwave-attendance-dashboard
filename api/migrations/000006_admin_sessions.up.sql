-- session_version: bumped on logout, password change/reset and deactivation;
-- a session cookie is valid only while its version matches.
-- must_change_password: set when the Owner creates or resets an admin's password.
ALTER TABLE admins ADD COLUMN session_version integer NOT NULL DEFAULT 0;
ALTER TABLE admins ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
