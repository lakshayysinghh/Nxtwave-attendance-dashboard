package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/term"

	"attendance-dashboard/api/internal/auth"
	"attendance-dashboard/api/internal/config"
	"attendance-dashboard/api/internal/db"
)

// runCreateOwner is the one-time Owner setup: it creates (or promotes) the
// OWNER_EMAIL admin and sets their password. It refuses to replace an
// existing password unless reset is true.
func runCreateOwner(cfg config.Config, reset bool) error {
	email := cfg.OwnerEmail
	if email == "" {
		return errors.New("set OWNER_EMAIL (in api/.env or the environment) to the Owner's email first")
	}
	return withQueries(cfg, func(ctx context.Context, q *db.Queries) error {
		existing, err := q.GetAdminByEmail(ctx, email)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		if err == nil && existing.PasswordHash.Valid && existing.PasswordHash.String != "" && !reset {
			return fmt.Errorf("%s already has a password; nothing was changed (use `create-owner --reset` to replace it)", email)
		}
		hash, err := askNewPassword(email)
		if err != nil {
			return err
		}
		owner, err := q.SetOwnerPassword(ctx, db.SetOwnerPasswordParams{Email: email, PasswordHash: hash})
		if err != nil {
			return err
		}
		fmt.Printf("Owner ready: %s (admin id %d). Sign in at /admin/login.\n", owner.Email, owner.ID)
		return nil
	})
}

// runSetPassword is an emergency reset from the console for an existing admin.
func runSetPassword(cfg config.Config, email string) error {
	email = strings.ToLower(strings.TrimSpace(email))
	return withQueries(cfg, func(ctx context.Context, q *db.Queries) error {
		if _, err := q.GetAdminByEmail(ctx, email); errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("no admin with email %s; the Owner creates admins on the Manage admins page", email)
		} else if err != nil {
			return err
		}
		hash, err := askNewPassword(email)
		if err != nil {
			return err
		}
		a, err := q.SetPasswordByEmail(ctx, db.SetPasswordByEmailParams{Email: email, PasswordHash: hash})
		if err != nil {
			return err
		}
		fmt.Printf("Password replaced for %s (role %s). Their existing sessions were signed out.\n", a.Email, a.Role)
		return nil
	})
}

func withQueries(cfg config.Config, fn func(context.Context, *db.Queries) error) error {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open db pool: %w", err)
	}
	defer pool.Close()
	if err := fn(ctx, db.New(pool)); err != nil {
		return fmt.Errorf("%w (are migrations applied? run: go run ./cmd/server migrate up)", err)
	}
	return nil
}

// askNewPassword prompts twice (hidden on a real console), checks the
// password policy and returns the bcrypt hash. The password is never printed.
func askNewPassword(email string) (string, error) {
	password, err := promptPassword("New password for " + email + ": ")
	if err != nil {
		return "", err
	}
	if term.IsTerminal(int(os.Stdin.Fd())) {
		again, err := promptPassword("Repeat the password: ")
		if err != nil {
			return "", err
		}
		if again != password {
			return "", errors.New("the passwords do not match; nothing was changed")
		}
	}
	return auth.HashPassword(password, email)
}

// promptPassword hides input on a real console (PowerShell, cmd). Terminals
// that cannot (for example Git Bash's mintty) fall back to a visible line.
func promptPassword(prompt string) (string, error) {
	fmt.Fprint(os.Stderr, prompt)
	if term.IsTerminal(int(os.Stdin.Fd())) {
		b, err := term.ReadPassword(int(os.Stdin.Fd()))
		fmt.Fprintln(os.Stderr)
		return string(b), err
	}
	fmt.Fprint(os.Stderr, "(this terminal cannot hide input; use PowerShell or cmd to hide it) ")
	line, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && line == "" {
		return "", errors.New("no password entered")
	}
	return strings.TrimRight(line, "\r\n"), nil
}
