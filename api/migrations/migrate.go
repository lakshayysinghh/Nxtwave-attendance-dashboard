package migrations

import (
	"errors"
	"fmt"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	_ "github.com/golang-migrate/migrate/v4/database/pgx/v5" // registers pgx5://
	"github.com/golang-migrate/migrate/v4/source/iofs"
)

// Direction is a migrate command accepted by Run.
type Direction string

const (
	Up      Direction = "up"
	Down    Direction = "down"     // roll back the most recent migration
	DownAll Direction = "down-all" // roll back every migration
)

// Run applies migrations in the given direction and returns the resulting
// version (0 when no migration is applied).
func Run(databaseURL string, dir Direction) (version uint, err error) {
	src, err := iofs.New(FS, ".")
	if err != nil {
		return 0, err
	}
	m, err := migrate.NewWithSourceInstance("iofs", src, migrateURL(databaseURL))
	if err != nil {
		return 0, fmt.Errorf("open migrations: %w", err)
	}
	defer func() {
		srcErr, dbErr := m.Close()
		if err == nil {
			err = errors.Join(srcErr, dbErr)
		}
	}()

	switch dir {
	case Up:
		err = m.Up()
	case Down:
		err = m.Steps(-1)
	case DownAll:
		err = m.Down()
	default:
		return 0, fmt.Errorf("unknown migrate direction %q (want up, down or down-all)", dir)
	}
	if err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return 0, fmt.Errorf("migrate %s: %w", dir, err)
	}

	version, dirty, err := m.Version()
	if errors.Is(err, migrate.ErrNilVersion) {
		return 0, nil
	}
	if err != nil {
		return 0, err
	}
	if dirty {
		return version, fmt.Errorf("migration %d is dirty", version)
	}
	return version, nil
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
