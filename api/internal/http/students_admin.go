package http

import (
	"cmp"
	"net/http"
	"regexp"
	"slices"
	"strconv"

	"attendance-dashboard/api/internal/stats"
)

type hallJSON struct {
	Hall     string `json:"hall"` // "" is students with no hall
	Students int64  `json:"students"`
}

// GET /api/admin/halls: active students per hall, in natural order
// (Hall 2 before Hall 10), with "no hall" last.
func (s *Server) handleListHalls(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListHalls(r.Context())
	if err != nil {
		s.internalError(w, "list halls", err)
		return
	}
	out := make([]hallJSON, len(rows))
	for i, h := range rows {
		out[i] = hallJSON{Hall: h.Hall, Students: h.Students}
	}
	slices.SortFunc(out, func(a, b hallJSON) int { return compareHalls(a.Hall, b.Hall) })
	writeJSON(w, http.StatusOK, map[string]any{"halls": out})
}

var trailingNumber = regexp.MustCompile(`^(.*?)(\d+)$`)

// compareHalls orders by the text before a trailing number, then by that
// number, so "Hall 2" < "Hall 10". The empty hall sorts last.
func compareHalls(a, b string) int {
	if (a == "") != (b == "") {
		if a == "" {
			return 1
		}
		return -1
	}
	ma, mb := trailingNumber.FindStringSubmatch(a), trailingNumber.FindStringSubmatch(b)
	if ma != nil && mb != nil && ma[1] == mb[1] {
		na, _ := strconv.Atoi(ma[2])
		nb, _ := strconv.Atoi(mb[2])
		if c := cmp.Compare(na, nb); c != 0 {
			return c
		}
	}
	return cmp.Compare(a, b)
}

// adminStudentJSON is the public student plus the fields only admins see.
type adminStudentJSON struct {
	studentJSON
	JoinedOn  string `json:"joined_on"`  // "" when blank (counts from the term start)
	DroppedOn string `json:"dropped_on"` // "" when not dropped
	Demo      bool   `json:"demo"`
}

// GET /api/admin/students/{niat_id}: the same profile the student sees, for
// any status, plus admin-only fields.
func (s *Server) handleAdminStudent(w http.ResponseWriter, r *http.Request) {
	st, ok := s.loadStudent(w, r, true)
	if !ok {
		return
	}
	out := adminStudentJSON{studentJSON: toStudentJSON(st), Demo: isDemoID(st.NiatID)}
	if st.JoinedOn.Valid {
		out.JoinedOn = stats.DateKey(st.JoinedOn.Time)
	}
	if st.DroppedOn.Valid {
		out.DroppedOn = stats.DateKey(st.DroppedOn.Time)
	}
	resp, err := s.profile(r.Context(), st, out)
	if err != nil {
		s.internalError(w, "admin profile", err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// GET /api/admin/students/{niat_id}/month?ym=: as the public month, for any status.
func (s *Server) handleAdminStudentMonth(w http.ResponseWriter, r *http.Request) {
	if st, ok := s.loadStudent(w, r, true); ok {
		s.month(w, r, st)
	}
}
