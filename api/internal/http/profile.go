package http

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/stats"
)

// niatIDPattern is the documented NIAT ID shape (docs/PLAN.md); demo IDs use N99.
var niatIDPattern = regexp.MustCompile(`^N\d{2}H\d{2}A\d{4}$`)

func normaliseNiatID(s string) string { return strings.ToUpper(strings.TrimSpace(s)) }

type termJSON struct {
	ID    int64  `json:"id"`
	Name  string `json:"name"`
	Start string `json:"start"`
	End   string `json:"end"`
}

type studentJSON struct {
	NiatID  string `json:"niat_id"`
	Name    string `json:"name"`
	Degree  string `json:"degree"`
	Section string `json:"section"`
	Level   string `json:"level"`
	HallNo  string `json:"hall_no"`
	POC     string `json:"poc"`   // "" when not assigned
	Coach   string `json:"coach"` // "" when not assigned
	Status  string `json:"status"`
}

type profileResponse struct {
	Student any                  `json:"student"`
	Term    *termJSON            `json:"term"`
	Today   string               `json:"today"`
	Summary stats.Summary        `json:"summary"`
	Months  []stats.MonthSummary `json:"months"`
	// Placement is the standing against the placement threshold; Remarks are
	// admin remarks by month (YYYY-MM).
	Placement stats.Placement   `json:"placement"`
	Remarks   map[string]string `json:"remarks"`
}

type dayJSON struct {
	Date     string  `json:"date"`
	Weekday  int     `json:"weekday"` // 0 = Sunday
	Kind     string  `json:"kind"`
	Label    string  `json:"label"`
	Excluded string  `json:"excluded"`
	Counted  bool    `json:"counted"`
	Status   *string `json:"status"` // "P", "A" or null; null on days that do not count
}

type monthResponse struct {
	Month   string        `json:"month"`
	Today   string        `json:"today"`
	Days    []dayJSON     `json:"days"`
	Summary stats.Summary `json:"summary"`
}

func toStudentJSON(s db.GetStudentRow) studentJSON {
	return studentJSON{
		NiatID: s.NiatID, Name: s.FullName, Degree: s.DegreeCode, Section: s.Section,
		Level: optText(s.Level), HallNo: optText(s.HallNo), POC: optText(s.PocName), Coach: optText(s.CoachName),
		Status: s.Status,
	}
}

func toTermJSON(r rules) *termJSON {
	if !r.has {
		return nil
	}
	return &termJSON{ID: r.term.ID, Name: r.term.Name, Start: stats.DateKey(r.term.Start), End: stats.DateKey(r.term.End)}
}

// loadStudent returns the student, or ok=false after writing a 404. Public
// callers hide dropped students.
func (s *Server) loadStudent(w http.ResponseWriter, r *http.Request, includeDropped bool) (db.GetStudentRow, bool) {
	id := normaliseNiatID(chi.URLParam(r, "niat_id"))
	st, err := s.store.GetStudent(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !includeDropped && st.Status != "active") {
		writeError(w, http.StatusNotFound, "not_found", "No student found with that NIAT ID.", nil)
		return st, false
	}
	if err != nil {
		s.internalError(w, "load student", err)
		return st, false
	}
	return st, true
}

// profile computes the term summary and monthly summaries for one student.
func (s *Server) profile(ctx context.Context, st db.GetStudentRow, student any) (profileResponse, error) {
	r, err := s.loadRules(ctx, calendarStart, calendarEnd)
	if err != nil {
		return profileResponse{}, err
	}
	resp := profileResponse{Student: student, Term: toTermJSON(r), Today: stats.DateKey(r.today), Months: []stats.MonthSummary{}}
	from, to := r.termRange()
	marks, err := s.loadMarks(ctx, []string{st.NiatID}, from, to)
	if err != nil {
		return profileResponse{}, err
	}
	stu := statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn)
	resp.Summary = stats.Summarize(stu, from, to, r.cal, r.terms, marks[st.NiatID], r.today)
	if r.has {
		resp.Months = stats.Months(stu, r.term, r.cal, r.terms, marks[st.NiatID], r.today)
	}
	resp.Placement = stats.PlacementStatus(resp.Summary, resp.Months)
	remarks, err := s.store.ListStudentRemarks(ctx, st.NiatID)
	if err != nil {
		return profileResponse{}, err
	}
	resp.Remarks = make(map[string]string, len(remarks))
	for _, rm := range remarks {
		resp.Remarks[rm.Month.Time.Format("2006-01")] = rm.Remark
	}
	return resp, nil
}

// month resolves every day of ym (YYYY-MM; default: this month) for a student.
func (s *Server) month(w http.ResponseWriter, r *http.Request, st db.GetStudentRow) {
	today := stats.TodayIST(s.now())
	first := stats.Date(today.Year(), today.Month(), 1)
	if ym := r.URL.Query().Get("ym"); ym != "" {
		t, err := time.Parse("2006-01", ym)
		if err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "ym must look like 2026-09.", nil)
			return
		}
		first = stats.Date(t.Year(), t.Month(), 1)
	}
	last := first.AddDate(0, 1, -1)

	rl, err := s.loadRules(r.Context(), first, last)
	if err != nil {
		s.internalError(w, "load rules", err)
		return
	}
	marks, err := s.loadMarks(r.Context(), []string{st.NiatID}, first, last)
	if err != nil {
		s.internalError(w, "load marks", err)
		return
	}
	stu := statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn)
	days := stats.MonthDays(stu, first, rl.cal, rl.terms, marks[st.NiatID], rl.today)

	resp := monthResponse{
		Month:   first.Format("2006-01"),
		Today:   stats.DateKey(rl.today),
		Days:    make([]dayJSON, len(days)),
		Summary: stats.Summarize(stu, first, last, rl.cal, rl.terms, marks[st.NiatID], rl.today),
	}
	for i, d := range days {
		resp.Days[i] = dayJSON{
			Date: stats.DateKey(d.Date), Weekday: int(d.Date.Weekday()), Kind: string(d.Kind), Label: d.Label,
			Excluded: string(d.Excluded), Counted: d.Counted,
			Status: markJSON(d.Status),
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) internalError(w http.ResponseWriter, what string, err error) {
	s.log.Error(what, "err", err)
	writeError(w, http.StatusInternalServerError, "internal", "Something went wrong. Please try again.", nil)
}
