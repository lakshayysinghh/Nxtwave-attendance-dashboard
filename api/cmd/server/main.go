// Command server runs the attendance API.
//
//	server                   start the HTTP server
//	server migrate up        apply all pending migrations
//	server migrate down      roll back the most recent migration
//	server migrate down-all  roll back every migration
//	server seed              load demo data (idempotent)
//	server seed --clear-demo delete N99 demo students and their marks
//	server create-owner      one-time setup: set the OWNER_EMAIL admin's password (prompted)
//	server create-owner --reset  replace the Owner's password
//	server set-password EMAIL    emergency password reset for an existing admin (prompted)
package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"
	_ "time/tzdata" // Asia/Kolkata must resolve even in a minimal container

	"github.com/jackc/pgx/v5/pgxpool"

	"attendance-dashboard/api/internal/auth"
	"attendance-dashboard/api/internal/config"
	"attendance-dashboard/api/internal/db"
	apihttp "attendance-dashboard/api/internal/http"
	"attendance-dashboard/api/internal/seed"
	"attendance-dashboard/api/internal/stats"
	"attendance-dashboard/api/migrations"
)

func main() {
	log := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	if err := run(log, os.Args[1:]); err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run(log *slog.Logger, args []string) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	if len(args) > 0 {
		switch {
		case len(args) == 2 && args[0] == "migrate":
			return runMigrate(log, cfg.DatabaseURL, migrations.Direction(args[1]))
		case len(args) == 1 && args[0] == "create-owner":
			return runCreateOwner(cfg, false)
		case len(args) == 2 && args[0] == "create-owner" && args[1] == "--reset":
			return runCreateOwner(cfg, true)
		case len(args) == 2 && args[0] == "set-password":
			return runSetPassword(cfg, args[1])
		case len(args) == 1 && args[0] == "seed":
			return runSeed(log, cfg, false)
		case len(args) == 2 && args[0] == "seed" && args[1] == "--clear-demo":
			return runSeed(log, cfg, true)
		}
		return fmt.Errorf("unknown command %q (want: migrate up|down|down-all, seed [--clear-demo], create-owner [--reset], set-password EMAIL)", strings.Join(args, " "))
	}

	if os.Getenv("MIGRATE_ON_START") == "true" {
		if err := runMigrate(log, cfg.DatabaseURL, migrations.Up); err != nil {
			return err
		}
	}
	return serve(log, cfg)
}

func serve(log *slog.Logger, cfg config.Config) error {
	ist, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		return fmt.Errorf("load Asia/Kolkata: %w", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open db pool: %w", err)
	}
	defer pool.Close()
	queries := db.New(pool)

	if cfg.OwnerEmail != "" {
		// Only inserts a missing Owner; never changes an existing admin or password.
		if err := queries.InsertOwnerIfMissing(ctx, cfg.OwnerEmail); err != nil {
			return fmt.Errorf("ensure owner admin (are migrations applied?): %w", err)
		}
	} else {
		log.Warn("OWNER_EMAIL is not set; no one can sign in until an admin exists")
	}

	var google auth.Provider
	if cfg.GoogleConfigured() {
		google = auth.NewGoogle(cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.GoogleRedirectURL())
	} else {
		log.Warn("Google sign-in is not configured; /api/auth/google/login will answer 503")
	}

	if cfg.DevLogin {
		log.Warn("DEV_LOGIN is on: POST /api/auth/dev-login signs in any active admin by email. Development only.")
	}

	srv := &http.Server{
		Addr: ":" + cfg.Port,
		Handler: apihttp.NewServer(apihttp.Deps{
			Log:           log,
			Store:         queries,
			Pool:          pool,
			Google:        google,
			Signer:        auth.NewSigner(cfg.SessionSecret),
			AppBaseURL:    cfg.AppBaseURL,
			SecureCookies: cfg.SecureCookies(),
			Location:      ist,
			DevLogin:      cfg.DevLogin,
		}).Routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	errc := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", srv.Addr, "env", cfg.Env)
		errc <- srv.ListenAndServe()
	}()

	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func runSeed(log *slog.Logger, cfg config.Config, clearDemo bool) error {
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return fmt.Errorf("open db pool: %w", err)
	}
	defer pool.Close()

	if clearDemo {
		students, marks, err := seed.ClearDemo(ctx, pool)
		if err != nil {
			return err
		}
		log.Info("demo data cleared (N99 students only)", "students_deleted", students, "marks_deleted", marks)
		return nil
	}
	res, err := seed.Run(ctx, pool, cfg.OwnerEmail, stats.TodayIST(time.Now()))
	if err != nil {
		return err
	}
	log.Info("seed done", "students_inserted", res.StudentsInserted, "marks_inserted", res.MarksInserted,
		"marked_until", stats.DateKey(res.MarkedUntil), "owner_email", cfg.OwnerEmail)
	return nil
}

func runMigrate(log *slog.Logger, databaseURL string, dir migrations.Direction) error {
	version, err := migrations.Run(databaseURL, dir)
	if err != nil {
		return err
	}
	log.Info("migrations done", "direction", dir, "version", version)
	return nil
}
