package auth

import (
	"errors"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const MinPasswordLength = 10

// bcryptCost is a variable so tests can use bcrypt.MinCost.
var bcryptCost = bcrypt.DefaultCost

// dummyHash is compared against when an email is unknown, so a failed login
// takes about as long whether or not the admin exists.
var dummyHash, _ = bcrypt.GenerateFromPassword([]byte("not-a-real-password"), bcrypt.DefaultCost)

var commonPasswords = []string{"password", "12345678", "qwerty", "letmein", "welcome", "admin", "nxtwave", "attendance"}

// ValidatePassword enforces a simple policy: 10 to 72 bytes, at least one
// letter and one digit, not the email's name part and not a common password.
func ValidatePassword(password, email string) error {
	if utf8.RuneCountInString(password) < MinPasswordLength {
		return errors.New("password must be at least 10 characters")
	}
	if len(password) > 72 {
		return errors.New("password must be at most 72 bytes")
	}
	if !strings.ContainsFunc(password, unicode.IsLetter) || !strings.ContainsFunc(password, unicode.IsDigit) {
		return errors.New("password must contain at least one letter and one digit")
	}
	lower := strings.ToLower(password)
	if local, _, _ := strings.Cut(strings.ToLower(email), "@"); len(local) >= 3 && strings.Contains(lower, local) {
		return errors.New("password must not contain the email address")
	}
	for _, c := range commonPasswords {
		if strings.Contains(lower, c) && len(lower)-len(c) <= 4 {
			return errors.New("password is too common; choose something less guessable")
		}
	}
	return nil
}

// HashPassword validates password for the given email and returns its bcrypt hash.
func HashPassword(password, email string) (string, error) {
	if err := ValidatePassword(password, email); err != nil {
		return "", err
	}
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(h), err
}

// CheckPassword reports whether password matches hash. An empty hash (no
// password set) never matches, but still costs one bcrypt comparison.
func CheckPassword(hash, password string) bool {
	if hash == "" {
		_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(password))
		return false
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}
