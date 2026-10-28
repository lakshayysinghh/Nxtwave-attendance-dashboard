package http

import (
	"context"
	"encoding/json"
	"net/http"
	"time"
)

type healthResponse struct {
	Status  string `json:"status"`
	DB      string `json:"db"`
	TimeIST string `json:"time_ist"`
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

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
