package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// ErrInvalidToken covers every reason a signed value is rejected: bad format,
// bad signature, wrong purpose or expired.
var ErrInvalidToken = errors.New("invalid or expired token")

// Purposes keep a token minted for one cookie from being accepted as another.
const (
	PurposeSession = "session"
	PurposeOAuth   = "oauth"
)

// Signer issues and checks HMAC-SHA256 signed, expiring JSON tokens of the
// form base64url(payload) "." base64url(mac).
type Signer struct {
	key []byte
}

func NewSigner(secret string) *Signer {
	return &Signer{key: []byte(secret)}
}

type envelope struct {
	Exp  int64           `json:"exp"`
	Data json.RawMessage `json:"data"`
}

// Sign encodes data and binds it to purpose until expires.
func (s *Signer) Sign(purpose string, data any, expires time.Time) (string, error) {
	raw, err := json.Marshal(data)
	if err != nil {
		return "", err
	}
	payload, err := json.Marshal(envelope{Exp: expires.Unix(), Data: raw})
	if err != nil {
		return "", err
	}
	body := base64.RawURLEncoding.EncodeToString(payload)
	return body + "." + base64.RawURLEncoding.EncodeToString(s.mac(purpose, body)), nil
}

// Verify checks the signature, purpose and expiry, then decodes into dst.
func (s *Signer) Verify(purpose, token string, now time.Time, dst any) error {
	body, sig, ok := strings.Cut(token, ".")
	if !ok {
		return ErrInvalidToken
	}
	gotMAC, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil || !hmac.Equal(gotMAC, s.mac(purpose, body)) {
		return ErrInvalidToken
	}
	payload, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return ErrInvalidToken
	}
	var env envelope
	if err := json.Unmarshal(payload, &env); err != nil {
		return ErrInvalidToken
	}
	if now.Unix() >= env.Exp {
		return ErrInvalidToken
	}
	if err := json.Unmarshal(env.Data, dst); err != nil {
		return ErrInvalidToken
	}
	return nil
}

func (s *Signer) mac(purpose, body string) []byte {
	h := hmac.New(sha256.New, s.key)
	h.Write([]byte(purpose))
	h.Write([]byte{0})
	h.Write([]byte(body))
	return h.Sum(nil)
}
