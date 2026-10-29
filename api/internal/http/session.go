package http

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"attendance-dashboard/api/internal/auth"
	"attendance-dashboard/api/internal/db"
)

// sessionClaims is the signed session cookie payload. A session is valid
// only while Version equals the admin's session_version, so bumping that
// column (logout, password change or reset, deactivation) ends it.
type sessionClaims struct {
	AdminID int64 `json:"admin_id"`
	Version int32 `json:"ver"`
}

// meResponse is the only shape an admin is returned in; it never carries the
// password hash.
type meResponse struct {
	ID                 int64  `json:"id"`
	Email              string `json:"email"`
	Name               string `json:"name"`
	Role               string `json:"role"`
	MustChangePassword bool   `json:"must_change_password"`
}

func toMe(a db.Admin) meResponse {
	return meResponse{ID: a.ID, Email: a.Email, Name: a.Name, Role: a.Role, MustChangePassword: a.MustChangePassword}
}

// startSession sets the session cookie for admin.
func (s *Server) startSession(w http.ResponseWriter, admin db.Admin) error {
	token, err := s.signer.Sign(auth.PurposeSession, sessionClaims{AdminID: admin.ID, Version: admin.SessionVersion}, s.now().Add(sessionTTL))
	if err != nil {
		return err
	}
	http.SetCookie(w, s.cookie(sessionCookie, token, "/", sessionTTL))
	return nil
}

var (
	errNoSession   = errors.New("no valid session")
	errDeactivated = errors.New("admin deactivated")
)

// sessionAdmin validates the cookie against the database: the admin must
// exist, be active, and still be on the cookie's session version.
func (s *Server) sessionAdmin(r *http.Request) (db.Admin, error) {
	c, err := r.Cookie(sessionCookie)
	var claims sessionClaims
	if err != nil || s.signer.Verify(auth.PurposeSession, c.Value, s.now(), &claims) != nil {
		return db.Admin{}, errNoSession
	}
	admin, err := s.store.GetAdminByID(r.Context(), claims.AdminID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return db.Admin{}, errNoSession
	case err != nil:
		return db.Admin{}, err
	case admin.SessionVersion != claims.Version:
		return db.Admin{}, errNoSession
	case !admin.Active:
		return db.Admin{}, errDeactivated
	}
	return admin, nil
}
