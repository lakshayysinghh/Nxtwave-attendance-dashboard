package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"attendance-dashboard/api/internal/auth"
)

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// POST /api/auth/login {email, password}: email + password sign-in for
// admins whose password was set with `server set-password`. Every failure
// (unknown email, wrong password, no password set, deactivated) gets the
// same message, so the response does not reveal which emails are admins.
func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Send your email and password.", nil)
		return
	}
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Enter your email and password.", nil)
		return
	}

	admin, err := s.store.GetAdminByEmail(r.Context(), email)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		s.internalError(w, "login: load admin", err)
		return
	}
	// CheckPassword runs bcrypt even when there is no stored hash, keeping timing similar.
	ok := auth.CheckPassword(admin.PasswordHash.String, req.Password)
	if err != nil || !ok || !admin.Active {
		s.log.Info("login refused")
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Invalid email or password.", nil)
		return
	}

	if err := s.startSession(w, admin); err != nil {
		s.internalError(w, "sign session", err)
		return
	}
	s.log.Info("admin signed in (password)", "admin_id", admin.ID)
	writeJSON(w, http.StatusOK, toMe(admin))
}
