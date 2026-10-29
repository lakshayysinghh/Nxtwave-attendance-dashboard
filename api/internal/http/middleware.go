package http

import (
	"context"
	"errors"
	"net/http"

	"attendance-dashboard/api/internal/db"
)

type adminKey struct{}

// adminFrom returns the admin set by requireAdmin.
func adminFrom(ctx context.Context) db.Admin {
	a, _ := ctx.Value(adminKey{}).(db.Admin)
	return a
}

// requireAdmin checks the session on every request against the database:
// 401 without a valid, current session (signed out, password changed, or
// expired), 403 for a deactivated admin.
func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		admin, err := s.sessionAdmin(r)
		switch {
		case errors.Is(err, errNoSession):
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in required.", nil)
			return
		case errors.Is(err, errDeactivated):
			writeError(w, http.StatusForbidden, "admin_deactivated", "This admin account has been deactivated.", nil)
			return
		case err != nil:
			s.internalError(w, "requireAdmin: load admin", err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), adminKey{}, admin)))
	})
}

// requirePasswordChanged must run after requireAdmin. It blocks admin APIs
// until an admin given a password by the Owner has chosen their own.
func (s *Server) requirePasswordChanged(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if adminFrom(r.Context()).MustChangePassword {
			writeError(w, http.StatusForbidden, "password_change_required", "Change your initial password before continuing.", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireOwner must run after requireAdmin.
func (s *Server) requireOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if adminFrom(r.Context()).Role != "owner" {
			writeError(w, http.StatusForbidden, "forbidden", "Only the Owner can do this.", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}
