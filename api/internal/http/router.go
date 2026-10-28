// Package http holds the API router, handlers and middleware.
package http

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// HealthStore is the database check used by /api/health.
// *db.Queries satisfies it.
type HealthStore interface {
	Ping(ctx context.Context) (int32, error)
}

type Server struct {
	log   *slog.Logger
	store HealthStore
	loc   *time.Location
	now   func() time.Time
}

func NewServer(log *slog.Logger, store HealthStore, loc *time.Location) *Server {
	return &Server{log: log, store: store, loc: loc, now: time.Now}
}

func (s *Server) Routes() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(s.requestLogger)
	r.Use(middleware.Recoverer)

	r.Route("/api", func(r chi.Router) {
		r.Get("/health", s.handleHealth)
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
