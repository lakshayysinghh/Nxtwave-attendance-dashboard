package http

import (
	"context"
	"net/http"
	"time"
)

type healthResponse struct {
	Status  string `json:"status"`
	DB      string `json:"db"`
	TimeIST string `json:"time_ist"`
}

// GET or HEAD /api/ping: liveness only, never touches the database. Point
// Render's health check and uptime monitors here, so keeping the server
// awake does not keep Neon awake (Neon bills compute for every hour it is
// not suspended). /api/health still checks the database, for manual checks.
func handlePing(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write([]byte("ok"))
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()

	resp := healthResponse{Status: "ok", DB: "ok", TimeIST: s.now().In(s.loc).Format(time.RFC3339)}
	code := http.StatusOK
	if _, err := s.store.Ping(ctx); err != nil {
		s.log.Error("health: db ping failed", "err", err)
		resp.Status, resp.DB = "degraded", "error"
		code = http.StatusServiceUnavailable
	}
	writeJSON(w, code, resp)
}
