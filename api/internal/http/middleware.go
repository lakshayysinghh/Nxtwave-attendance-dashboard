package http

import (
	"context"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"attendance-dashboard/api/internal/auth"
	"attendance-dashboard/api/internal/db"
)

type adminKey struct{}

// adminFrom returns the admin set by requireAdmin.
func adminFrom(ctx context.Context) db.Admin {
	a, _ := ctx.Value(adminKey{}).(db.Admin)
	return a
}

// requireAdmin accepts a valid session cookie whose admin still exists and is
// active: 401 without a valid session, 403 for a deactivated admin. The
// database check means deactivating an admin takes effect at once.
func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(sessionCookie)
		var claims sessionClaims
		if err != nil || s.signer.Verify(auth.PurposeSession, c.Value, s.now(), &claims) != nil {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in required.", nil)
			return
		}
		admin, err := s.store.GetAdminByID(r.Context(), claims.AdminID)
		if errors.Is(err, pgx.ErrNoRows) {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "Sign in required.", nil)
			return
		}
		if err == nil && !admin.Active {
			writeError(w, http.StatusForbidden, "admin_deactivated", "This admin account has been deactivated.", nil)
			return
		}
		if err != nil {
			s.log.Error("requireAdmin: load admin", "err", err)
			writeError(w, http.StatusInternalServerError, "internal", "Could not check the session.", nil)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), adminKey{}, admin)))
	})
}

// requireOwner must run after requireAdmin.
func (s *Server) requireOwner(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if adminFrom(r.Context()).Role != "owner" {
			writeError(w, http.StatusForbidden, "forbidden", "Only an owner can do this.", nil)
			return
		}
		next.ServeHTTP(w, r)
	})
}
