package http

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"attendance-dashboard/api/internal/auth"
	"attendance-dashboard/api/internal/db"
)

// adminJSON is how the Owner sees an admin: never the password or its hash.
type adminJSON struct {
	ID                 int64  `json:"id"`
	Email              string `json:"email"`
	Name               string `json:"name"`
	Role               string `json:"role"`
	Active             bool   `json:"active"`
	HasPassword        bool   `json:"has_password"`
	MustChangePassword bool   `json:"must_change_password"`
}

func toAdminJSON(a db.Admin) adminJSON {
	return adminJSON{
		ID: a.ID, Email: a.Email, Name: a.Name, Role: a.Role, Active: a.Active,
		HasPassword: a.PasswordHash.Valid && a.PasswordHash.String != "", MustChangePassword: a.MustChangePassword,
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "The request body is not valid JSON.", nil)
		return false
	}
	return true
}

// POST /api/auth/password {current_password, new_password}: an admin changes
// their own password. Other sessions end; this one continues with a new cookie.
func (s *Server) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Current string `json:"current_password"`
		New     string `json:"new_password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	admin := adminFrom(r.Context())
	if !auth.CheckPassword(admin.PasswordHash.String, req.Current) {
		writeError(w, http.StatusUnauthorized, "invalid_credentials", "Your current password is not correct.", nil)
		return
	}
	if req.New == req.Current {
		writeError(w, http.StatusUnprocessableEntity, "weak_password", "Choose a password different from the current one.", nil)
		return
	}
	hash, err := auth.HashPassword(req.New, admin.Email)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "weak_password", capitalise(err.Error())+".", nil)
		return
	}
	updated, err := s.store.SetPasswordByID(r.Context(), db.SetPasswordByIDParams{ID: admin.ID, PasswordHash: hash, MustChange: false})
	if err != nil {
		s.internalError(w, "change password", err)
		return
	}
	if err := s.startSession(w, updated); err != nil {
		s.internalError(w, "sign session", err)
		return
	}
	s.log.Info("admin changed own password", "admin_id", admin.ID)
	writeJSON(w, http.StatusOK, toMe(updated))
}

// GET /api/admin/admins (Owner only).
func (s *Server) handleListAdmins(w http.ResponseWriter, r *http.Request) {
	list, err := s.store.ListAdmins(r.Context())
	if err != nil {
		s.internalError(w, "list admins", err)
		return
	}
	out := make([]adminJSON, len(list))
	for i, a := range list {
		out[i] = toAdminJSON(a)
	}
	writeJSON(w, http.StatusOK, map[string]any{"admins": out})
}

// POST /api/admin/admins {name, email, password} (Owner only): creates a
// regular admin who must change this initial password at first sign-in.
func (s *Server) handleCreateAdmin(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string `json:"name"`
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	name := strings.Join(strings.Fields(req.Name), " ")
	email := strings.ToLower(strings.TrimSpace(req.Email))
	if name == "" || len(name) > 100 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_name", "Enter the admin's name (up to 100 characters).", nil)
		return
	}
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email {
		writeError(w, http.StatusUnprocessableEntity, "invalid_email", "Enter a valid email address.", nil)
		return
	}
	hash, err := auth.HashPassword(req.Password, email)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "weak_password", capitalise(err.Error())+".", nil)
		return
	}
	created, err := s.store.CreateAdmin(r.Context(), db.CreateAdminParams{Email: email, Name: name, PasswordHash: hash})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "duplicate_email", "An admin with this email already exists.", nil)
		return
	}
	if err != nil {
		s.internalError(w, "create admin", err)
		return
	}
	s.log.Info("admin created", "by", adminFrom(r.Context()).ID, "admin_id", created.ID)
	writeJSON(w, http.StatusCreated, toAdminJSON(created))
}

// POST /api/admin/admins/{id}/password {password} (Owner only): replaces the
// password, ends that admin's sessions and makes them choose a new one.
func (s *Server) handleResetAdminPassword(w http.ResponseWriter, r *http.Request) {
	target, ok := s.targetAdmin(w, r)
	if !ok {
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	hash, err := auth.HashPassword(req.Password, target.Email)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "weak_password", capitalise(err.Error())+".", nil)
		return
	}
	// Resetting your own password here would lock you into a forced change;
	// use the change-password form for that.
	mustChange := target.ID != adminFrom(r.Context()).ID
	updated, err := s.store.SetPasswordByID(r.Context(), db.SetPasswordByIDParams{ID: target.ID, PasswordHash: hash, MustChange: mustChange})
	if err != nil {
		s.internalError(w, "reset password", err)
		return
	}
	s.log.Info("admin password reset", "by", adminFrom(r.Context()).ID, "admin_id", target.ID)
	if !mustChange {
		_ = s.startSession(w, updated) // keep the Owner signed in after resetting their own password
	}
	writeJSON(w, http.StatusOK, toAdminJSON(updated))
}

// PATCH /api/admin/admins/{id} {name?, email?, active?, role?} (Owner only).
// At least one active Owner must always remain; deactivating or changing the
// email ends the admin's sessions (the Owner editing their own email stays
// signed in).
func (s *Server) handleUpdateAdmin(w http.ResponseWriter, r *http.Request) {
	target, ok := s.targetAdmin(w, r)
	if !ok {
		return
	}
	var req struct {
		Name   *string `json:"name"`
		Email  *string `json:"email"`
		Active *bool   `json:"active"`
		Role   *string `json:"role"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	name, email := target.Name, target.Email
	if req.Name != nil {
		name = strings.Join(strings.Fields(*req.Name), " ")
		if name == "" || len(name) > 100 {
			writeError(w, http.StatusUnprocessableEntity, "invalid_name", "Enter the admin's name (up to 100 characters).", nil)
			return
		}
	}
	if req.Email != nil {
		email = strings.ToLower(strings.TrimSpace(*req.Email))
		if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email {
			writeError(w, http.StatusUnprocessableEntity, "invalid_email", "Enter a valid email address.", nil)
			return
		}
		if other, err := s.store.GetAdminByEmail(r.Context(), email); err == nil && other.ID != target.ID {
			writeError(w, http.StatusConflict, "duplicate_email", "Another admin already uses this email.", nil)
			return
		} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			s.internalError(w, "check admin email", err)
			return
		}
	}
	active, role := target.Active, target.Role
	if req.Active != nil {
		active = *req.Active
	}
	if req.Role != nil {
		role = *req.Role
	}
	if role != "owner" && role != "admin" {
		writeError(w, http.StatusUnprocessableEntity, "invalid_role", `Role must be "owner" or "admin".`, nil)
		return
	}

	var updated db.Admin
	lastOwner := false
	err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		owners, err := q.LockActiveOwners(r.Context())
		if err != nil {
			return err
		}
		stillOwner := active && role == "owner"
		wasOwner := target.Active && target.Role == "owner"
		if wasOwner && !stillOwner && len(owners) <= 1 {
			lastOwner = true
			return nil
		}
		if name != target.Name || email != target.Email {
			if _, err := q.UpdateAdminProfile(r.Context(), db.UpdateAdminProfileParams{ID: target.ID, Name: name, Email: email}); err != nil {
				return err
			}
		}
		updated, err = q.UpdateAdminAccess(r.Context(), db.UpdateAdminAccessParams{ID: target.ID, Active: active, Role: role})
		return err
	})
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" { // the email was taken in the meantime
		writeError(w, http.StatusConflict, "duplicate_email", "Another admin already uses this email.", nil)
		return
	}
	if err != nil {
		s.internalError(w, "update admin", err)
		return
	}
	if lastOwner {
		writeError(w, http.StatusConflict, "last_owner",
			"This is the only active Owner. Make another admin an Owner before deactivating or demoting this account.", nil)
		return
	}
	if updated.ID == adminFrom(r.Context()).ID && updated.Active {
		_ = s.startSession(w, updated) // an email change ended the Owner's own session
	}
	s.log.Info("admin updated", "by", adminFrom(r.Context()).ID, "admin_id", target.ID, "active", active, "role", role,
		"email_changed", email != target.Email)
	writeJSON(w, http.StatusOK, toAdminJSON(updated))
}

// DELETE /api/admin/admins/{id} (Owner only). You cannot delete yourself or
// the last active Owner. Marks and imports they saved are kept. Their session
// stops working because the account no longer exists.
func (s *Server) handleDeleteAdmin(w http.ResponseWriter, r *http.Request) {
	target, ok := s.targetAdmin(w, r)
	if !ok {
		return
	}
	if target.ID == adminFrom(r.Context()).ID {
		writeError(w, http.StatusConflict, "cannot_delete_self", "You cannot delete your own account.", nil)
		return
	}
	lastOwner := false
	err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		owners, err := q.LockActiveOwners(r.Context())
		if err != nil {
			return err
		}
		if target.Active && target.Role == "owner" && len(owners) <= 1 {
			lastOwner = true
			return nil
		}
		_, err = q.DeleteAdmin(r.Context(), target.ID)
		return err
	})
	if err != nil {
		s.internalError(w, "delete admin", err)
		return
	}
	if lastOwner {
		writeError(w, http.StatusConflict, "last_owner", "This is the only active Owner and cannot be deleted.", nil)
		return
	}
	s.log.Info("admin deleted", "by", adminFrom(r.Context()).ID, "admin_id", target.ID)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) targetAdmin(w http.ResponseWriter, r *http.Request) (db.Admin, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "No such admin.", nil)
		return db.Admin{}, false
	}
	a, err := s.store.GetAdminByID(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "No such admin.", nil)
		return a, false
	}
	if err != nil {
		s.internalError(w, "load admin", err)
		return a, false
	}
	return a, true
}

func capitalise(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}
