// Package config loads API settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/joho/godotenv"
)

// localDatabaseURL matches the Postgres service in docker-compose.yml.
const localDatabaseURL = "postgres://attendance:attendance@localhost:5433/attendance?sslmode=disable"

type Config struct {
	Env                string // "development" or "production"
	DatabaseURL        string
	Port               string
	AppBaseURL         string
	SessionSecret      string
	GoogleClientID     string
	GoogleClientSecret string
	OwnerEmail         string
}

func (c Config) IsProduction() bool { return c.Env == "production" }

// Load reads the environment. A .env file in the working directory is read
// only when APP_ENV is not "production"; real env vars always win over it.
func Load() (Config, error) {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if env == "" {
		env = "development"
	}
	if env != "development" && env != "production" {
		return Config{}, fmt.Errorf("APP_ENV must be development or production, got %q", env)
	}
	if env == "development" {
		if err := godotenv.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
			return Config{}, fmt.Errorf("read .env: %w", err)
		}
	}
	return fromEnv(env, os.Getenv)
}

func fromEnv(env string, getenv func(string) string) (Config, error) {
	get := func(key string) string { return strings.TrimSpace(getenv(key)) }

	cfg := Config{
		Env:                env,
		DatabaseURL:        get("DATABASE_URL"),
		Port:               get("PORT"),
		AppBaseURL:         strings.TrimRight(get("APP_BASE_URL"), "/"),
		SessionSecret:      get("SESSION_SECRET"),
		GoogleClientID:     get("GOOGLE_CLIENT_ID"),
		GoogleClientSecret: get("GOOGLE_CLIENT_SECRET"),
		OwnerEmail:         strings.ToLower(get("OWNER_EMAIL")),
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.DatabaseURL == "" {
		if cfg.IsProduction() {
			return Config{}, errors.New("DATABASE_URL is required")
		}
		cfg.DatabaseURL = localDatabaseURL
	}
	if cfg.AppBaseURL == "" && !cfg.IsProduction() {
		cfg.AppBaseURL = "http://localhost:3000"
	}
	return cfg, nil
}
