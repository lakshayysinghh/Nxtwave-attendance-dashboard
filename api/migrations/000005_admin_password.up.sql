-- Email + password sign-in: bcrypt hash only, never the password.
-- NULL means no password set (that admin cannot use password login).
ALTER TABLE admins ADD COLUMN password_hash text;
