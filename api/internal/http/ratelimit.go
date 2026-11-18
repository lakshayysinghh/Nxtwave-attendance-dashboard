package http

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/httprate"
)

// Rate limits. Every limiter answers 429 in the API error shape with a
// Retry-After header (seconds), which the web app honours.
const (
	// Per client IP across all logins: a backstop against password spraying.
	loginPerIPLimit = 60
	// Per client IP + email: brute force on one account. Keyed with the IP so
	// that, once TRUSTED_PROXY_HOPS is set, a stranger cannot lock an admin out.
	loginPerAccountLimit = 10
	// Per signed-in admin for /auth/me and every /admin route. Generous: a busy
	// page loads 4-5 queries, and admins share office networks, so this is keyed
	// on the admin, not the IP.
	adminPerMinuteLimit = 300
	// Per signed-in admin for password change and owner transfer.
	sensitivePerMinuteLimit = 10
)

func newRateLimiter(requests int, window time.Duration) *httprate.RateLimiter {
	return httprate.NewRateLimiter(requests, window, httprate.WithLimitHandler(rateLimited(window)))
}

func rateLimited(window time.Duration) http.HandlerFunc {
	msg := fmt.Sprintf("Too many requests. Try again in %s.", humanWindow(window))
	return func(w http.ResponseWriter, _ *http.Request) {
		// httprate has already set Retry-After to the window length.
		writeError(w, http.StatusTooManyRequests, "rate_limited", msg, nil)
	}
}

func humanWindow(d time.Duration) string {
	if d == time.Minute {
		return "a minute"
	}
	if d%time.Minute == 0 {
		return strconv.Itoa(int(d/time.Minute)) + " minutes"
	}
	return strconv.Itoa(int(d/time.Second)) + " seconds"
}

// limitPerIP limits each client IP (see clientIP) to requests per window.
func (s *Server) limitPerIP(requests int, window time.Duration) func(http.Handler) http.Handler {
	return httprate.LimitBy(requests, window, func(r *http.Request) (string, error) {
		return "ip:" + s.clientIP(r), nil
	}, httprate.WithLimitHandler(rateLimited(window)))
}

// limitPerAdmin limits each signed-in admin. It must run after requireAdmin;
// keying on the verified admin ID cannot be spoofed and does not penalise
// admins who share one office IP.
func (s *Server) limitPerAdmin(requests int, window time.Duration) func(http.Handler) http.Handler {
	return httprate.LimitBy(requests, window, func(r *http.Request) (string, error) {
		return "admin:" + strconv.FormatInt(adminFrom(r.Context()).ID, 10), nil
	}, httprate.WithLimitHandler(rateLimited(window)))
}

// clientIP returns the caller's IP. With proxyHops == 0 it is the TCP peer,
// which cannot be spoofed. Behind proxies (Vercel, then Render's edge) the
// peer is the last proxy, so set TRUSTED_PROXY_HOPS to the number of proxies
// that append to X-Forwarded-For in front of this server: the client is then
// the entry that many places from the right. Entries further left were sent
// by the client and are ignored, so a forged header cannot pick the key.
func (s *Server) clientIP(r *http.Request) string {
	return clientIPFrom(r, s.proxyHops)
}

func clientIPFrom(r *http.Request, proxyHops int) string {
	if proxyHops > 0 {
		var hops []string
		for _, h := range r.Header.Values("X-Forwarded-For") {
			for part := range strings.SplitSeq(h, ",") {
				if p := strings.TrimSpace(part); p != "" {
					hops = append(hops, p)
				}
			}
		}
		if len(hops) > 0 {
			// Fewer entries than proxies means the request skipped an outer
			// proxy; the leftmost entry was still written by a trusted one.
			i := max(len(hops)-proxyHops, 0)
			if ip, err := netip.ParseAddr(hops[i]); err == nil {
				return httprate.CanonicalizeIP(ip.String())
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return httprate.CanonicalizeIP(host)
}
