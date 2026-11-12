package http

import (
	"net/http"
	"time"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/stats"
)

// maxRangeDays bounds a date filter (a little over a year).
const maxRangeDays = 400

// rangeParam reads ?from=&to= (YYYY-MM-DD, both or neither). set is false
// when neither is given; a bad pair writes a 400 and returns ok=false.
func rangeParam(w http.ResponseWriter, r *http.Request) (from, to time.Time, set, ok bool) {
	f, t := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if f == "" && t == "" {
		return from, to, false, true
	}
	var err error
	if from, err = parseDate(f); err != nil {
		writeError(w, http.StatusBadRequest, "bad_range", "From: "+err.Error(), nil)
		return from, to, false, false
	}
	if to, err = parseDate(t); err != nil {
		writeError(w, http.StatusBadRequest, "bad_range", "To: "+err.Error(), nil)
		return from, to, false, false
	}
	if to.Before(from) {
		writeError(w, http.StatusBadRequest, "bad_range", "The To date must be on or after the From date.", nil)
		return from, to, false, false
	}
	if to.Sub(from) > maxRangeDays*24*time.Hour {
		writeError(w, http.StatusBadRequest, "bad_range", "Choose at most 400 days.", nil)
		return from, to, false, false
	}
	return from, to, true, true
}

type rangeResponse struct {
	From    string        `json:"from"`
	To      string        `json:"to"`
	Summary stats.Summary `json:"summary"`
	// Clipped is true when the dates asked for were narrowed to the term
	// (the student view only covers the current term).
	Clipped bool `json:"clipped"`
	// OutsideTerm is true when no asked-for date is in the term.
	OutsideTerm bool `json:"outside_term"`
}

// rangeSummary counts one student's days from..to. With clip (the student
// view) the range is narrowed to the current term.
func (s *Server) rangeSummary(w http.ResponseWriter, r *http.Request, st db.GetStudentRow, clip bool) {
	from, to, set, ok := rangeParam(w, r)
	if !ok {
		return
	}
	if !set {
		writeError(w, http.StatusBadRequest, "bad_range", "Choose a From and a To date.", nil)
		return
	}
	rl, err := s.loadRules(r.Context(), calendarStart, calendarEnd)
	if err != nil {
		s.internalError(w, "load rules", err)
		return
	}
	resp := rangeResponse{From: stats.DateKey(from), To: stats.DateKey(to)}
	if clip {
		f, t, overlap := stats.Term{}.Start, stats.Term{}.End, false
		if rl.has {
			f, t, overlap = stats.ClipToTerm(from, to, rl.term)
		}
		if !overlap {
			resp.OutsideTerm = true
			resp.Summary.Band = stats.BandOf(nil)
			writeJSON(w, http.StatusOK, resp)
			return
		}
		resp.Clipped = !f.Equal(from) || !t.Equal(to)
		from, to = f, t
		resp.From, resp.To = stats.DateKey(from), stats.DateKey(to)
	}
	marks, err := s.loadMarks(r.Context(), []string{st.NiatID}, from, to)
	if err != nil {
		s.internalError(w, "load marks", err)
		return
	}
	stu := statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn)
	resp.Summary = stats.Summarize(stu, from, to, rl.cal, rl.terms, marks[st.NiatID], rl.today)
	writeJSON(w, http.StatusOK, resp)
}

// GET /api/public/students/{niat_id}/range?from=&to=: the student's counts
// for those dates, within the current term.
func (s *Server) handlePublicRange(w http.ResponseWriter, r *http.Request) {
	if st, ok := s.loadStudent(w, r, false); ok {
		s.rangeSummary(w, r, st, true)
	}
}

// GET /api/admin/students/{niat_id}/range?from=&to=: the same, any dates and status.
func (s *Server) handleAdminStudentRange(w http.ResponseWriter, r *http.Request) {
	if st, ok := s.loadStudent(w, r, true); ok {
		s.rangeSummary(w, r, st, false)
	}
}
