// Package testdb gives tests a throwaway Postgres database. It never touches
// the database named in TEST_DATABASE_URL beyond creating and dropping its own
// attendance_test_* databases.
package testdb

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"attendance-dashboard/api/migrations"
)

// Empty creates an empty database and returns its URL; it is dropped when the
// test ends. The test is skipped when TEST_DATABASE_URL is not set.
func Empty(t testing.TB) string {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { admin.Close(ctx) })

	b := make([]byte, 6)
	_, _ = rand.Read(b)
	name := "attendance_test_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "CREATE DATABASE "+name); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := admin.Exec(ctx, "DROP DATABASE IF EXISTS "+name+" WITH (FORCE)"); err != nil {
			t.Errorf("drop %s: %v", name, err)
		}
	})

	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	return u.String()
}

// Migrated is Empty plus all migrations applied, returned as a pool.
func Migrated(t testing.TB) (*pgxpool.Pool, string) {
	t.Helper()
	dbURL := Empty(t)
	if _, err := migrations.Run(dbURL, migrations.Up); err != nil {
		t.Fatalf("migrate up: %v", err)
	}
	pool, err := pgxpool.New(context.Background(), dbURL)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return pool, dbURL
}
