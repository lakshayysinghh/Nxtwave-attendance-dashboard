package http

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/stats"
)

// GET /api/public/students/{niat_id}: profile, term summary and monthly summaries.
func (s *Server) handlePublicProfile(w http.ResponseWriter, r *http.Request) {
	st, ok := s.loadStudent(w, r, false)
	if !ok {
		return
	}
	resp, err := s.profile(r.Context(), st, toStudentJSON(st))
	if err != nil {
		s.internalError(w, "profile", err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

// GET /api/public/students/{niat_id}/month?ym=YYYY-MM: per-day FH/SH marks.
func (s *Server) handlePublicMonth(w http.ResponseWriter, r *http.Request) {
	if st, ok := s.loadStudent(w, r, false); ok {
		s.month(w, r, st)
	}
}

// lowThreshold is the default "low attendance" line (75%).
const lowThreshold = 75

type adminRow struct {
	NiatID  string        `json:"niat_id"`
	Name    string        `json:"name"`
	Degree  string        `json:"degree"`
	Section string        `json:"section"`
	Status  string        `json:"status"`
	Summary stats.Summary `json:"summary"`
	Band    stats.Band    `json:"band"`
}

// GET /api/admin/students?q=: students matching part of a name or NIAT ID,
// with term summaries.
func (s *Server) handleAdminStudents(w http.ResponseWriter, r *http.Request) {
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	rows, err := s.store.ListStudentsForAdmin(r.Context(), db.ListStudentsForAdminParams{Pattern: likePattern(q)})
	if err != nil {
		s.internalError(w, "list students", err)
		return
	}
	rl, err := s.loadRules(r.Context(), calendarStart, calendarEnd)
	if err != nil {
		s.internalError(w, "load rules", err)
		return
	}
	from, to := rl.termRange()
	ids := make([]string, len(rows))
	for i, st := range rows {
		ids[i] = st.NiatID
	}
	marks, err := s.loadMarks(r.Context(), ids, from, to)
	if err != nil {
		s.internalError(w, "load marks", err)
		return
	}
	out := make([]adminRow, len(rows))
	sums := make([]stats.Summary, len(rows))
	for i, st := range rows {
		stu := statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn)
		out[i] = adminRow{
			NiatID: st.NiatID, Name: st.FullName, Degree: st.DegreeCode, Section: st.Section, Status: st.Status,
			Summary: stats.Summarize(stu, from, to, rl.cal, rl.terms, marks[st.NiatID], rl.today),
		}
		sums[i] = out[i].Summary
		out[i].Band = stats.BandOf(out[i].Summary.Pct)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"term": toTermJSON(rl), "today": stats.DateKey(rl.today), "students": out,
		"overview": stats.Summarise(sums, lowThreshold),
	})
}

type sheetRow struct {
	NiatID  string  `json:"niat_id"`
	Name    string  `json:"name"`
	Degree  string  `json:"degree"`
	Counted bool    `json:"counted"`
	Reason  string  `json:"reason"` // why the day cannot be marked, when !counted
	FH      *string `json:"fh"`
	SH      *string `json:"sh"`
}

// GET /api/admin/attendance/sheet?date=YYYY-MM-DD (default today): every
// active student's FH/SH marks for the date.
func (s *Server) handleAdminSheet(w http.ResponseWriter, r *http.Request) {
	rl, err := s.loadRules(r.Context(), calendarStart, calendarEnd)
	if err != nil {
		s.internalError(w, "load rules", err)
		return
	}
	date := rl.today
	if v := r.URL.Query().Get("date"); v != "" {
		if date, err = parseDate(v); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", err.Error(), nil)
			return
		}
	}
	students, err := s.store.ListStudentsForAdmin(r.Context(), db.ListStudentsForAdminParams{})
	if err != nil {
		s.internalError(w, "list students", err)
		return
	}
	var ids []string
	for _, st := range students {
		if st.Status == "active" {
			ids = append(ids, st.NiatID)
		}
	}
	marks, err := s.loadMarks(r.Context(), ids, date, date)
	if err != nil {
		s.internalError(w, "load marks", err)
		return
	}
	rows := []sheetRow{}
	for _, st := range students {
		if st.Status != "active" {
			continue
		}
		day := stats.ResolveDay(date, statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn), rl.cal, rl.terms, rl.today)
		h := marks[st.NiatID][stats.DateKey(date)]
		row := sheetRow{NiatID: st.NiatID, Name: st.FullName, Degree: st.DegreeCode, Counted: day.Counted, FH: markJSON(h[0]), SH: markJSON(h[1])}
		if !day.Counted {
			row.Reason = notCountedReason(day)
		}
		rows = append(rows, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{"date": stats.DateKey(date), "today": stats.DateKey(rl.today), "students": rows})
}

type markInput struct {
	NiatID string  `json:"niat_id"`
	Date   string  `json:"date"`
	Half   int16   `json:"half"`
	Status *string `json:"status"` // "P", "A" or null to clear
}

type rowError struct {
	Index   int    `json:"index"`
	NiatID  string `json:"niat_id"`
	Message string `json:"message"`
}

// PUT /api/admin/attendance: [{niat_id, date, half, status}]. All rows are
// checked first; if any fails nothing is saved (422 with per-row errors).
func (s *Server) handleSaveAttendance(w http.ResponseWriter, r *http.Request) {
	var in []markInput
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil || len(in) == 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "Send a non-empty JSON array of marks.", nil)
		return
	}
	rl, err := s.loadRules(r.Context(), calendarStart, calendarEnd)
	if err != nil {
		s.internalError(w, "load rules", err)
		return
	}
	ids := make([]string, len(in))
	for i := range in {
		in[i].NiatID = normaliseNiatID(in[i].NiatID)
		ids[i] = in[i].NiatID
	}
	found, err := s.store.GetStudentsByIDs(r.Context(), ids)
	if err != nil {
		s.internalError(w, "load students", err)
		return
	}
	byID := map[string]db.Student{}
	for _, st := range found {
		byID[st.NiatID] = st
	}

	var errs []rowError
	var set, toClear db.UpsertMarksParams
	for i, m := range in {
		fail := func(msg string) { errs = append(errs, rowError{Index: i, NiatID: m.NiatID, Message: msg}) }
		st, ok := byID[m.NiatID]
		date, dErr := parseDate(m.Date)
		switch {
		case !ok:
			fail("Unknown NIAT ID.")
		case st.Status != "active":
			fail("Student is not active.")
		case dErr != nil:
			fail(dErr.Error())
		case m.Half != 1 && m.Half != 2:
			fail("half must be 1 (first half) or 2 (second half).")
		case m.Status != nil && *m.Status != "P" && *m.Status != "A":
			fail(`status must be "P", "A" or null.`)
		default:
			day := stats.ResolveDay(date, statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn), rl.cal, rl.terms, rl.today)
			if !day.Counted {
				fail(notCountedReason(day))
				continue
			}
			target := &set
			status := ""
			if m.Status == nil {
				target = &toClear
			} else {
				status = *m.Status
			}
			target.NiatIds = append(target.NiatIds, m.NiatID)
			target.Dates = append(target.Dates, pgDate(date))
			target.Halves = append(target.Halves, m.Half)
			target.Statuses = append(target.Statuses, status)
		}
	}
	if len(errs) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed",
			fmt.Sprintf("%d of %d marks were refused; nothing was saved.", len(errs), len(in)), errs)
		return
	}

	set.UpdatedBy = adminFrom(r.Context()).ID
	err = pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		if len(set.NiatIds) > 0 {
			if _, err := q.UpsertMarks(r.Context(), set); err != nil {
				return err
			}
		}
		if len(toClear.NiatIds) > 0 {
			_, err := q.DeleteMarks(r.Context(), db.DeleteMarksParams{NiatIds: toClear.NiatIds, Dates: toClear.Dates, Halves: toClear.Halves})
			return err
		}
		return nil
	})
	if err != nil {
		s.internalError(w, "save marks", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]int{"saved": len(set.NiatIds), "cleared": len(toClear.NiatIds)})
}
