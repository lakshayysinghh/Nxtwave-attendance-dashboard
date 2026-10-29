// Package http holds the API router, handlers and middleware.
package http

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"

	"attendance-dashboard/api/internal/auth"
	"attendance-dashboard/api/internal/db"
)

// Store is the sqlc Querier; *db.Queries satisfies it and unit tests use fakes.
type Store = db.Querier

// Deps are the server's collaborators.
type Deps struct {
	Log   *slog.Logger
	Store Store
	// Pool runs transactions (saving marks). Unit tests that never save may leave it nil.
	Pool *pgxpool.Pool
	// Google is nil when sign-in is not configured (local dev without credentials).
	Google        auth.Provider
	Signer        *auth.Signer
	AppBaseURL    string
	SecureCookies bool
	Location      *time.Location // Asia/Kolkata
	// DevLogin routes POST /api/auth/dev-login (development only).
	DevLogin bool
}

type Server struct {
	log           *slog.Logger
	store         Store
	pool          *pgxpool.Pool
	google        auth.Provider
	signer        *auth.Signer
	appBaseURL    string
	secureCookies bool
	loc           *time.Location
	devLogin      bool
	now           func() time.Time
}

func NewServer(d Deps) *Server {
	return &Server{
		log:           d.Log,
		store:         d.Store,
		pool:          d.Pool,
		google:        d.Google,
		signer:        d.Signer,
		appBaseURL:    d.AppBaseURL,
		secureCookies: d.SecureCookies,
		loc:           d.Location,
		devLogin:      d.DevLogin,
		now:           time.Now,
	}
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(s.requestLogger)
	r.Use(middleware.Recoverer)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", s.handleHealth)

		r.Route("/auth", func(r chi.Router) {
			r.Get("/google/login", s.handleGoogleLogin)
			r.Get("/google/callback", s.handleGoogleCallback)
			r.Post("/logout", s.handleLogout)
			if s.devLogin {
				r.Post("/dev-login", s.handleDevLogin)
			}
			r.With(s.requireAdmin).Get("/me", s.handleMe)
		})

		r.Get("/public/students/{niat_id}", s.handlePublicProfile)
		r.Get("/public/students/{niat_id}/month", s.handlePublicMonth)

		r.Route("/admin", func(r chi.Router) {
			r.Use(s.requireAdmin)
			r.Get("/students", s.handleAdminStudents)
			r.Get("/attendance/sheet", s.handleAdminSheet)
			r.Put("/attendance", s.handleSaveAttendance)
			r.Post("/imports/students", s.handleImportStudents)
			r.Post("/imports/attendance", s.handleImportAttendance)
		})

		r.NotFound(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusNotFound, "not_found", "No such endpoint.", nil)
		})
		r.MethodNotAllowed(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "Method not allowed.", nil)
		})
	})
	return r
}

func (s *Server) requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		start := time.Now()
		next.ServeHTTP(ww, r)
		s.log.Info("request",
			"method", r.Method,
			"path", r.URL.Path,
			"status", ww.Status(),
			"duration_ms", time.Since(start).Milliseconds(),
			"request_id", middleware.GetReqID(r.Context()),
		)
	})
}
