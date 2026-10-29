package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"attendance-dashboard/api/internal/auth"
)

type devLoginRequest struct {
	Email string `json:"email"`
}

// handleDevLogin signs in an active admin by email alone. It is only routed
// when APP_ENV=development and DEV_LOGIN=true (config refuses DEV_LOGIN
// anywhere else), so in every other setup the path answers 404.
func (s *Server) handleDevLogin(w http.ResponseWriter, r *http.Request) {
	var req devLoginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", `Send JSON like {"email": "you@example.com"}.`, nil)
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Email is required.", nil)
		return
	}

	admin, err := s.store.GetAdminByEmail(r.Context(), email)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !admin.Active) {
		writeError(w, http.StatusForbidden, "not_authorised", "This email is not an active admin.", nil)
		return
	}
	if err != nil {
		s.log.Error("dev login: load admin", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Could not sign in.", nil)
		return
	}

	token, err := s.signer.Sign(auth.PurposeSession, sessionClaims{AdminID: admin.ID}, s.now().Add(sessionTTL))
	if err != nil {
		s.log.Error("sign session", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Could not sign in.", nil)
		return
	}
	http.SetCookie(w, s.cookie(sessionCookie, token, "/", sessionTTL))
	s.log.Info("admin signed in (dev login)", "admin_id", admin.ID)
	writeJSON(w, http.StatusOK, meResponse{ID: admin.ID, Email: admin.Email, Name: admin.Name, Role: admin.Role})
}
