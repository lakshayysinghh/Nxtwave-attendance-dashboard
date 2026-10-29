package auth

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

const (
	googleIssuer  = "https://accounts.google.com"
	googleJWKSURL = "https://www.googleapis.com/oauth2/v3/certs"
)

// Identity is what a verified Google ID token says about the user.
type Identity struct {
	Subject       string
	Email         string // lowercased
	EmailVerified bool
	Name          string
}

// Provider is the Google side of sign-in. Tests substitute a fake.
type Provider interface {
	// AuthCodeURL is where the browser is sent to sign in.
	AuthCodeURL(state, nonce, codeVerifier string) string
	// Exchange trades the callback code for tokens and returns the identity
	// from the ID token after checking its signature, issuer, audience,
	// expiry and nonce.
	Exchange(ctx context.Context, code, codeVerifier, nonce string) (Identity, error)
}

type google struct {
	oauth    oauth2.Config
	verifier *oidc.IDTokenVerifier
}

// NewGoogle builds the provider without network calls; Google's signing keys
// are fetched (and cached) on the first verification.
func NewGoogle(clientID, clientSecret, redirectURL string) Provider {
	keys := oidc.NewRemoteKeySet(context.Background(), googleJWKSURL)
	return &google{
		oauth: oauth2.Config{
			ClientID:     clientID,
			ClientSecret: clientSecret,
			RedirectURL:  redirectURL,
			Endpoint: oauth2.Endpoint{
				AuthURL:  "https://accounts.google.com/o/oauth2/v2/auth",
				TokenURL: "https://oauth2.googleapis.com/token",
			},
			Scopes: []string{oidc.ScopeOpenID, "email", "profile"},
		},
		verifier: oidc.NewVerifier(googleIssuer, keys, &oidc.Config{ClientID: clientID}),
	}
}

func (g *google) AuthCodeURL(state, nonce, codeVerifier string) string {
	return g.oauth.AuthCodeURL(state,
		oidc.Nonce(nonce),
		oauth2.S256ChallengeOption(codeVerifier),
		oauth2.SetAuthURLParam("prompt", "select_account"),
	)
}

func (g *google) Exchange(ctx context.Context, code, codeVerifier, nonce string) (Identity, error) {
	tok, err := g.oauth.Exchange(ctx, code, oauth2.VerifierOption(codeVerifier))
	if err != nil {
		return Identity{}, fmt.Errorf("exchange code: %w", err)
	}
	raw, ok := tok.Extra("id_token").(string)
	if !ok || raw == "" {
		return Identity{}, errors.New("token response has no id_token")
	}
	idt, err := g.verifier.Verify(ctx, raw)
	if err != nil {
		return Identity{}, fmt.Errorf("verify id_token: %w", err)
	}
	if idt.Nonce != nonce {
		return Identity{}, errors.New("id_token nonce mismatch")
	}
	var claims struct {
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := idt.Claims(&claims); err != nil {
		return Identity{}, fmt.Errorf("read id_token claims: %w", err)
	}
	return Identity{
		Subject:       idt.Subject,
		Email:         strings.ToLower(strings.TrimSpace(claims.Email)),
		EmailVerified: claims.EmailVerified,
		Name:          strings.TrimSpace(claims.Name),
	}, nil
}
