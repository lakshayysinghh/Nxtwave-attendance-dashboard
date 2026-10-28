// Command server runs the attendance API.
//
//	server               start the HTTP server
//	server migrate up    apply all pending migrations
//	server migrate down  roll back the most recent migration
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

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/pgxpool"

	"attendance-dashboard/api/internal/config"
	"attendance-dashboard/api/internal/db"
	apihttp "attendance-dashboard/api/internal/http"
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
		if len(args) == 2 && args[0] == "migrate" {
			return runMigrate(log, cfg.DatabaseURL, args[1])
		}
		return fmt.Errorf("unknown command %q (want: migrate up|down)", strings.Join(args, " "))
	}

	if os.Getenv("MIGRATE_ON_START") == "true" {
		if err := runMigrate(log, cfg.DatabaseURL, "up"); err != nil {
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

	srv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           apihttp.NewServer(log, db.New(pool), ist).Routes(),
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

func runMigrate(log *slog.Logger, databaseURL, direction string) error {
	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		return err
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, migrateURL(databaseURL))
	if err != nil {
		return fmt.Errorf("open migrations: %w", err)
	}
	defer m.Close()

	switch direction {
	case "up":
		err = m.Up()
	case "down":
		err = m.Steps(-1)
	default:
		return fmt.Errorf("unknown migrate direction %q (want up or down)", direction)
	}
	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return fmt.Errorf("migrate %s: %w", direction, err)
	}
	version, dirty, _ := m.Version()
	log.Info("migrations done", "direction", direction, "version", version, "dirty", dirty)
	return nil
}

// migrateURL switches a postgres:// URL to the pgx/v5 driver's scheme.
func migrateURL(databaseURL string) string {
	for _, prefix := range []string{"postgresql://", "postgres://"} {
		if strings.HasPrefix(databaseURL, prefix) {
			return "pgx5://" + strings.TrimPrefix(databaseURL, prefix)
		}
	}
	return databaseURL
}
