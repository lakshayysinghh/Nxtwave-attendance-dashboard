package http

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"net/http"
	"net/url"
	"time"

	"github.com/jackc/pgx/v5"

	"attendance-dashboard/api/internal/auth"
	"attendance-dashboard/api/internal/db"
)

const (
	sessionCookie = "att_session"
	sessionTTL    = 8 * time.Hour

	// oauthCookie carries state, nonce and the PKCE verifier between the
	// login redirect and the callback.
	oauthCookie     = "att_oauth"
	oauthCookiePath = "/api/auth/google"
	oauthTTL        = 10 * time.Minute
)

// Values for ?error= on /admin/login; the web app maps them to messages.
const (
	loginErrNotAuthorised = "not_authorised"
	loginErrCancelled     = "cancelled"
	loginErrFailed        = "sign_in_failed"
)

type oauthFlow struct {
	State    string `json:"state"`
	Nonce    string `json:"nonce"`
	Verifier string `json:"verifier"`
}

func (s *Server) handleGoogleLogin(w http.ResponseWriter, r *http.Request) {
	if s.google == nil {
		writeError(w, http.StatusServiceUnavailable, "sign_in_not_configured",
			"Google sign-in is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.", nil)
		return
	}
	flow := oauthFlow{State: randomToken(), Nonce: randomToken(), Verifier: randomToken()}
	value, err := s.signer.Sign(auth.PurposeOAuth, flow, s.now().Add(oauthTTL))
	if err != nil {
		s.log.Error("sign oauth cookie", "err", err)
		writeError(w, http.StatusInternalServerError, "internal", "Could not start sign-in.", nil)
		return
	}
	http.SetCookie(w, s.cookie(oauthCookie, value, oauthCookiePath, oauthTTL))
	http.Redirect(w, r, s.google.AuthCodeURL(flow.State, flow.Nonce, flow.Verifier), http.StatusFound)
}

func (s *Server) handleGoogleCallback(w http.ResponseWriter, r *http.Request) {
	// The flow cookie is single-use whatever happens next.
	http.SetCookie(w, s.cookie(oauthCookie, "", oauthCookiePath, -1))

	if s.google == nil {
		s.redirectToLogin(w, r, loginErrFailed)
		return
	}
	q := r.URL.Query()
	if q.Get("error") != "" {
		s.redirectToLogin(w, r, loginErrCancelled)
		return
	}

	var flow oauthFlow
	c, err := r.Cookie(oauthCookie)
	if err != nil || s.signer.Verify(auth.PurposeOAuth, c.Value, s.now(), &flow) != nil ||
		q.Get("state") == "" || q.Get("state") != flow.State {
		s.log.Warn("oauth callback: missing or mismatched state")
		s.redirectToLogin(w, r, loginErrFailed)
		return
	}

	id, err := s.google.Exchange(r.Context(), q.Get("code"), flow.Verifier, flow.Nonce)
	if err != nil {
		s.log.Error("oauth callback: exchange failed", "err", err)
		s.redirectToLogin(w, r, loginErrFailed)
		return
	}
	if !id.EmailVerified || id.Email == "" {
		s.log.Warn("oauth callback: unverified email")
		s.redirectToLogin(w, r, loginErrNotAuthorised)
		return
	}

	admin, err := s.store.GetAdminByEmail(r.Context(), id.Email)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !admin.Active) {
		s.log.Info("sign-in refused: not an active admin")
		s.redirectToLogin(w, r, loginErrNotAuthorised)
		return
	}
	if err != nil {
		s.log.Error("oauth callback: load admin", "err", err)
		s.redirectToLogin(w, r, loginErrFailed)
		return
	}
	if id.Name != "" && admin.Name == "" {
		if err := s.store.SetAdminNameIfEmpty(r.Context(), db.SetAdminNameIfEmptyParams{ID: admin.ID, Name: id.Name}); err != nil {
			s.log.Warn("oauth callback: save admin name", "err", err)
		}
	}

	if err := s.startSession(w, admin); err != nil {
		s.log.Error("sign session", "err", err)
		s.redirectToLogin(w, r, loginErrFailed)
		return
	}
	s.log.Info("admin signed in", "admin_id", admin.ID)
	http.Redirect(w, r, s.appBaseURL+"/admin", http.StatusFound)
}

// handleLogout ends the session on the server (by bumping the admin's
// session version, which also signs out their other devices) and clears the cookie.
func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	if admin, err := s.sessionAdmin(r); err == nil {
		if err := s.store.EndSessions(r.Context(), admin.ID); err != nil {
			s.internalError(w, "logout", err)
			return
		}
		s.log.Info("admin signed out", "admin_id", admin.ID)
	}
	http.SetCookie(w, s.cookie(sessionCookie, "", "/", -1))
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	a := adminFrom(r.Context())
	writeJSON(w, http.StatusOK, toMe(a))
}

func (s *Server) redirectToLogin(w http.ResponseWriter, r *http.Request, reason string) {
	http.Redirect(w, r, s.appBaseURL+"/admin/login?error="+url.QueryEscape(reason), http.StatusFound)
}

// cookie builds an HttpOnly, SameSite=Lax cookie. maxAge < 0 deletes it.
func (s *Server) cookie(name, value, path string, maxAge time.Duration) *http.Cookie {
	c := &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     path,
		HttpOnly: true,
		Secure:   s.secureCookies,
		SameSite: http.SameSiteLaxMode,
	}
	if maxAge < 0 {
		c.MaxAge = -1
	} else {
		c.MaxAge = int(maxAge.Seconds())
		c.Expires = s.now().Add(maxAge)
	}
	return c
}

func randomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b) // crypto/rand.Read never returns an error
	return base64.RawURLEncoding.EncodeToString(b)
}
