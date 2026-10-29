package http

import (
	"net"
	"net/http"
	"time"

	"github.com/go-chi/httprate"
)

// RateLimitByIP limits each client to requests per window and answers 429 in
// the API error shape. It is not applied anywhere yet; Phase 4 attaches it to
// the public endpoints.
func RateLimitByIP(requests int, window time.Duration) func(http.Handler) http.Handler {
	return httprate.LimitBy(requests, window, remoteAddrKey,
		httprate.WithLimitHandler(func(w http.ResponseWriter, _ *http.Request) {
			writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many requests. Try again in a minute.", nil)
		}),
	)
}

// remoteAddrKey keys on the TCP peer, which clients cannot spoof. Behind
// Vercel and Render that peer is the proxy, not the student, so Phase 4 must
// replace it with a key read from a forwarding header the proxies set.
func remoteAddrKey(r *http.Request) (string, error) {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	return httprate.CanonicalizeIP(host), nil
}
