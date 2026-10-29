// Package config loads API settings from environment variables.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strings"

	"github.com/joho/godotenv"
)

const (
	// localDatabaseURL matches the Postgres service in docker-compose.yml.
	localDatabaseURL = "postgres://attendance:attendance@localhost:5433/attendance?sslmode=disable"
	// devSessionSecret keeps local sessions valid across restarts. Never used in production.
	devSessionSecret    = "dev-only-insecure-session-secret-do-not-use"
	minSessionSecretLen = 32
)

type Config struct {
	Env                string // "development" or "production"
	DatabaseURL        string
	Port               string
	AppBaseURL         string
	SessionSecret      string
	GoogleClientID     string
	GoogleClientSecret string
	OwnerEmail         string
	// DevLogin enables POST /api/auth/dev-login. Only allowed when Env is development.
	DevLogin bool
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
		DevLogin:           strings.EqualFold(get("DEV_LOGIN"), "true"),
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	if cfg.DevLogin && cfg.Env != "development" {
		return Config{}, fmt.Errorf("DEV_LOGIN=true is only allowed when APP_ENV=development (APP_ENV is %q)", cfg.Env)
	}

	if cfg.IsProduction() {
		var missing []string
		for key, val := range map[string]string{
			"DATABASE_URL":         cfg.DatabaseURL,
			"APP_BASE_URL":         cfg.AppBaseURL,
			"SESSION_SECRET":       cfg.SessionSecret,
			"GOOGLE_CLIENT_ID":     cfg.GoogleClientID,
			"GOOGLE_CLIENT_SECRET": cfg.GoogleClientSecret,
			"OWNER_EMAIL":          cfg.OwnerEmail,
		} {
			if val == "" {
				missing = append(missing, key)
			}
		}
		if len(missing) > 0 {
			slices.Sort(missing)
			return Config{}, fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
		}
	} else {
		if cfg.DatabaseURL == "" {
			cfg.DatabaseURL = localDatabaseURL
		}
		if cfg.AppBaseURL == "" {
			cfg.AppBaseURL = "http://localhost:3000"
		}
		if cfg.SessionSecret == "" {
			cfg.SessionSecret = devSessionSecret
		}
	}

	if len(cfg.SessionSecret) < minSessionSecretLen {
		return Config{}, fmt.Errorf("SESSION_SECRET must be at least %d characters", minSessionSecretLen)
	}
	u, err := url.Parse(cfg.AppBaseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || (u.Path != "" && u.Path != "/") {
		return Config{}, fmt.Errorf("APP_BASE_URL must be an origin like https://example.com, got %q", cfg.AppBaseURL)
	}
	if cfg.IsProduction() && u.Scheme != "https" {
		return Config{}, errors.New("APP_BASE_URL must use https in production")
	}
	return cfg, nil
}

// GoogleConfigured reports whether Google sign-in can be offered.
func (c Config) GoogleConfigured() bool {
	return c.GoogleClientID != "" && c.GoogleClientSecret != ""
}

// SecureCookies is false only for a plain-http local APP_BASE_URL, so the
// session cookie still works in browsers that refuse Secure cookies over http.
func (c Config) SecureCookies() bool {
	u, err := url.Parse(c.AppBaseURL)
	if err != nil {
		return true
	}
	local := u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"
	return u.Scheme != "http" || !local
}

// GoogleRedirectURL is the OAuth callback, reached through the web app's /api rewrite.
func (c Config) GoogleRedirectURL() string {
	return c.AppBaseURL + "/api/auth/google/callback"
}
