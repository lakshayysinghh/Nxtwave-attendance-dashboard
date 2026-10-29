package http

import (
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/stats"
)

type termRow struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Start     string `json:"start"`
	End       string `json:"end"`
	IsCurrent bool   `json:"is_current"`
}

func toTermRow(t db.Term) termRow {
	return termRow{ID: t.ID, Name: t.Name, Start: stats.DateKey(t.StartDate.Time), End: stats.DateKey(t.EndDate.Time), IsCurrent: t.IsCurrent}
}

// GET /api/admin/terms
func (s *Server) handleListTerms(w http.ResponseWriter, r *http.Request) {
	terms, err := s.store.ListTerms(r.Context())
	if err != nil {
		s.internalError(w, "list terms", err)
		return
	}
	out := make([]termRow, len(terms))
	for i, t := range terms {
		out[i] = toTermRow(t)
	}
	writeJSON(w, http.StatusOK, map[string]any{"terms": out, "today": stats.DateKey(stats.TodayIST(s.now()))})
}

type termInput struct {
	Name      *string `json:"name"`
	Start     *string `json:"start"`
	End       *string `json:"end"`
	IsCurrent *bool   `json:"is_current"`
}

// POST /api/admin/terms {name, start, end, is_current?}
func (s *Server) handleCreateTerm(w http.ResponseWriter, r *http.Request) {
	var in termInput
	if !decodeJSON(w, r, &in) {
		return
	}
	name, start, end, ok := validateTerm(w, in, db.Term{})
	if !ok {
		return
	}
	var created db.Term
	err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		var err error
		if created, err = q.CreateTerm(r.Context(), db.CreateTermParams{Name: name, StartDate: pgDate(start), EndDate: pgDate(end)}); err != nil {
			return err
		}
		if in.IsCurrent != nil && *in.IsCurrent {
			created, err = makeCurrent(r, q, created.ID)
		}
		return err
	})
	if s.termConflict(w, r, err, 0) {
		return
	}
	if err != nil {
		s.internalError(w, "create term", err)
		return
	}
	writeJSON(w, http.StatusCreated, toTermRow(created))
}

// PATCH /api/admin/terms/{id} {name?, start?, end?, is_current: true?}
func (s *Server) handleUpdateTerm(w http.ResponseWriter, r *http.Request) {
	current, ok := s.loadTerm(w, r)
	if !ok {
		return
	}
	var in termInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.IsCurrent != nil && !*in.IsCurrent {
		writeError(w, http.StatusUnprocessableEntity, "invalid_term", "Pick another term as current instead of unsetting this one.", nil)
		return
	}
	name, start, end, ok := validateTerm(w, in, current)
	if !ok {
		return
	}
	var updated db.Term
	err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		var err error
		if updated, err = q.UpdateTerm(r.Context(), db.UpdateTermParams{ID: current.ID, Name: name, StartDate: pgDate(start), EndDate: pgDate(end)}); err != nil {
			return err
		}
		if in.IsCurrent != nil && *in.IsCurrent {
			updated, err = makeCurrent(r, q, current.ID)
		}
		return err
	})
	if s.termConflict(w, r, err, current.ID) {
		return
	}
	if err != nil {
		s.internalError(w, "update term", err)
		return
	}
	writeJSON(w, http.StatusOK, toTermRow(updated))
}

// DELETE /api/admin/terms/{id}: refused while attendance falls inside the term.
func (s *Server) handleDeleteTerm(w http.ResponseWriter, r *http.Request) {
	t, ok := s.loadTerm(w, r)
	if !ok {
		return
	}
	n, err := s.store.CountAttendanceBetween(r.Context(), db.CountAttendanceBetweenParams{FromDate: t.StartDate, ToDate: t.EndDate})
	if err != nil {
		s.internalError(w, "count attendance", err)
		return
	}
	if n > 0 {
		writeError(w, http.StatusConflict, "term_has_attendance",
			fmt.Sprintf("%d attendance record(s) fall inside %s, so it cannot be deleted. You can still edit its name or dates.", n, t.Name), nil)
		return
	}
	if _, err := s.store.DeleteTerm(r.Context(), t.ID); err != nil {
		s.internalError(w, "delete term", err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func makeCurrent(r *http.Request, q *db.Queries, id int64) (db.Term, error) {
	if err := q.ClearCurrentTerm(r.Context(), id); err != nil {
		return db.Term{}, err
	}
	return q.MarkTermCurrent(r.Context(), id)
}

// validateTerm merges the input over base (for edits) and checks it.
func validateTerm(w http.ResponseWriter, in termInput, base db.Term) (string, time.Time, time.Time, bool) {
	name, start, end := base.Name, base.StartDate.Time, base.EndDate.Time
	if in.Name != nil {
		name = strings.Join(strings.Fields(*in.Name), " ")
	}
	var err error
	if in.Start != nil {
		if start, err = parseDate(*in.Start); err != nil {
			writeError(w, http.StatusUnprocessableEntity, "invalid_term", "Start date: "+err.Error(), nil)
			return "", start, end, false
		}
	}
	if in.End != nil {
		if end, err = parseDate(*in.End); err != nil {
			writeError(w, http.StatusUnprocessableEntity, "invalid_term", "End date: "+err.Error(), nil)
			return "", start, end, false
		}
	}
	switch {
	case name == "" || len(name) > 100:
		writeError(w, http.StatusUnprocessableEntity, "invalid_term", "Enter a term name (up to 100 characters).", nil)
	case start.IsZero() || end.IsZero():
		writeError(w, http.StatusUnprocessableEntity, "invalid_term", "Enter both a start and an end date.", nil)
	case end.Before(start):
		writeError(w, http.StatusUnprocessableEntity, "invalid_term", "The end date must be on or after the start date.", nil)
	case end.Sub(start) > 400*24*time.Hour:
		writeError(w, http.StatusUnprocessableEntity, "invalid_term", "A term cannot be longer than about a year.", nil)
	default:
		return name, start, end, true
	}
	return "", start, end, false
}

// termConflict turns the database's no-overlap rule into a readable 409.
func (s *Server) termConflict(w http.ResponseWriter, r *http.Request, err error, selfID int64) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23P01" {
		return false
	}
	msg := "These dates overlap another term."
	if terms, lerr := s.store.ListTerms(r.Context()); lerr == nil {
		var names []string
		for _, t := range terms {
			if t.ID != selfID {
				names = append(names, fmt.Sprintf("%s (%s to %s)", t.Name, stats.DateKey(t.StartDate.Time), stats.DateKey(t.EndDate.Time)))
			}
		}
		if len(names) > 0 {
			msg += " Existing terms: " + strings.Join(names, "; ") + "."
		}
	}
	writeError(w, http.StatusConflict, "term_overlap", msg, nil)
	return true
}

func (s *Server) loadTerm(w http.ResponseWriter, r *http.Request) (db.Term, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "No such term.", nil)
		return db.Term{}, false
	}
	t, err := s.store.GetTerm(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "not_found", "No such term.", nil)
		return t, false
	}
	if err != nil {
		s.internalError(w, "load term", err)
		return t, false
	}
	return t, true
}

type calendarEntryJSON struct {
	AppliesTo string `json:"applies_to"`
	DayType   string `json:"day_type"`
	Counts    bool   `json:"counts"`
	Label     string `json:"label"`
}

type calendarDayJSON struct {
	Date    string              `json:"date"`
	Weekday int                 `json:"weekday"` // 0 = Sunday
	Kind    string              `json:"kind"`    // resolved for the view: working, holiday, exam, event, sunday
	Label   string              `json:"label"`
	InTerm  bool                `json:"in_term"`
	Counted bool                `json:"counted"` // counts toward attendance for this view (ignoring join/drop dates)
	Entries []calendarEntryJSON `json:"entries"` // stored entries on this date (every applies_to)
}

// GET /api/admin/calendar?ym=YYYY-MM&view=ALL|BITS|CDU: every day of the
// month resolved with the attendance rules for that view, plus stored entries.
func (s *Server) handleCalendarMonth(w http.ResponseWriter, r *http.Request) {
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
	degrees, ok := s.degreeCodes(w, r)
	if !ok {
		return
	}
	view := strings.ToUpper(r.URL.Query().Get("view"))
	if view == "" {
		view = "ALL"
	}
	if view != "ALL" && !degrees[view] {
		writeError(w, http.StatusBadRequest, "bad_request", "view must be ALL or a degree code.", nil)
		return
	}
	last := first.AddDate(0, 1, -1)
	rl, err := s.loadRules(r.Context(), first, last)
	if err != nil {
		s.internalError(w, "load rules", err)
		return
	}
	stored, err := s.store.ListCalendarDays(r.Context(), db.ListCalendarDaysParams{FromDate: pgDate(first), ToDate: pgDate(last)})
	if err != nil {
		s.internalError(w, "list calendar", err)
		return
	}
	byDate := map[string][]calendarEntryJSON{}
	for _, e := range stored {
		k := stats.DateKey(e.Date.Time)
		byDate[k] = append(byDate[k], calendarEntryJSON{AppliesTo: e.AppliesTo, DayType: e.DayType, Counts: e.Counts, Label: e.Label})
	}

	// The calendar shows what the rules say for any date, so future dates are
	// resolved as if they had passed; only the term limits apply.
	student := stats.Student{Degree: view}
	days := []calendarDayJSON{}
	for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
		day := stats.ResolveDay(d, student, rl.cal, rl.terms, calendarEnd)
		entries := byDate[stats.DateKey(d)]
		if entries == nil {
			entries = []calendarEntryJSON{}
		}
		days = append(days, calendarDayJSON{
			Date: stats.DateKey(d), Weekday: int(d.Weekday()), Kind: string(day.Kind), Label: day.Label,
			InTerm: day.Excluded != stats.OutsideTerm, Counted: day.Counted, Entries: entries,
		})
	}
	codes := append([]string{"ALL"}, sortedKeys(degrees)...)
	writeJSON(w, http.StatusOK, map[string]any{
		"month": first.Format("2006-01"), "view": view, "today": stats.DateKey(today), "applies_to": codes, "days": days,
	})
}

type calendarInput struct {
	From           string `json:"from"`
	To             string `json:"to"`
	AppliesTo      string `json:"applies_to"`
	DayType        string `json:"day_type"`
	Counts         *bool  `json:"counts"` // events only; default true
	Label          string `json:"label"`
	IncludeSundays bool   `json:"include_sundays"`
}

// PUT /api/admin/calendar {from, to, applies_to, day_type, counts?, label, include_sundays}:
// sets every date in the range (replacing entries for the same applies_to).
func (s *Server) handleSetCalendar(w http.ResponseWriter, r *http.Request) {
	var in calendarInput
	if !decodeJSON(w, r, &in) {
		return
	}
	from, to, appliesTo, ok := s.calendarRange(w, r, in.From, in.To, in.AppliesTo)
	if !ok {
		return
	}
	kind := stats.Kind(strings.ToLower(strings.TrimSpace(in.DayType)))
	counts := false
	switch kind {
	case stats.KindWorking:
		counts = true
	case stats.KindHoliday, stats.KindExam:
	case stats.KindEvent:
		counts = in.Counts == nil || *in.Counts
	default:
		writeError(w, http.StatusUnprocessableEntity, "invalid_day_type", "Day type must be working, holiday, exam or event.", nil)
		return
	}
	label := strings.Join(strings.Fields(in.Label), " ")
	if len(label) > 100 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_label", "The label can be up to 100 characters.", nil)
		return
	}
	n, err := s.store.UpsertCalendarRange(r.Context(), db.UpsertCalendarRangeParams{
		AppliesTo: appliesTo, DayType: string(kind), Counts: counts, Label: label,
		FromDate: pgDate(from), ToDate: pgDate(to), SkipSundays: !in.IncludeSundays,
	})
	if err != nil {
		s.internalError(w, "save calendar", err)
		return
	}
	marked, err := s.store.CountMarkedDatesForDegree(r.Context(), db.CountMarkedDatesForDegreeParams{FromDate: pgDate(from), ToDate: pgDate(to), AppliesTo: appliesTo})
	if err != nil {
		s.internalError(w, "count marked dates", err)
		return
	}
	resp := map[string]any{"saved": n}
	if marked > 0 {
		verb := "now count"
		if !counts {
			verb = "no longer count"
		}
		resp["warning"] = fmt.Sprintf("%d of these date(s) already have attendance marks. The marks are kept, but they %s toward percentages.", marked, verb)
	}
	s.log.Info("calendar updated", "admin_id", adminFrom(r.Context()).ID, "applies_to", appliesTo, "day_type", kind, "dates", n)
	writeJSON(w, http.StatusOK, resp)
}

// DELETE /api/admin/calendar?from=&to=&applies_to=: removes entries, so those
// dates fall back to the next rule (ALL entry, Sunday or working day).
func (s *Server) handleDeleteCalendar(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to, appliesTo, ok := s.calendarRange(w, r, q.Get("from"), q.Get("to"), q.Get("applies_to"))
	if !ok {
		return
	}
	n, err := s.store.DeleteCalendarRange(r.Context(), db.DeleteCalendarRangeParams{FromDate: pgDate(from), ToDate: pgDate(to), AppliesTo: appliesTo})
	if err != nil {
		s.internalError(w, "delete calendar", err)
		return
	}
	s.log.Info("calendar entries removed", "admin_id", adminFrom(r.Context()).ID, "applies_to", appliesTo, "removed", n)
	writeJSON(w, http.StatusOK, map[string]int64{"deleted": n})
}

func (s *Server) calendarRange(w http.ResponseWriter, r *http.Request, fromS, toS, applies string) (time.Time, time.Time, string, bool) {
	from, err := parseDate(fromS)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_range", "From: "+err.Error(), nil)
		return from, from, "", false
	}
	to := from
	if toS != "" {
		if to, err = parseDate(toS); err != nil {
			writeError(w, http.StatusUnprocessableEntity, "invalid_range", "To: "+err.Error(), nil)
			return from, to, "", false
		}
	}
	if to.Before(from) {
		writeError(w, http.StatusUnprocessableEntity, "invalid_range", "The end date must be on or after the start date.", nil)
		return from, to, "", false
	}
	if to.Sub(from) > 366*24*time.Hour {
		writeError(w, http.StatusUnprocessableEntity, "invalid_range", "Choose a range of at most one year.", nil)
		return from, to, "", false
	}
	degrees, ok := s.degreeCodes(w, r)
	if !ok {
		return from, to, "", false
	}
	applies = strings.ToUpper(strings.TrimSpace(applies))
	if applies != "ALL" && !degrees[applies] {
		writeError(w, http.StatusUnprocessableEntity, "invalid_applies_to", "Applies to must be All or a degree (BITS, CDU).", nil)
		return from, to, "", false
	}
	return from, to, applies, true
}

func (s *Server) degreeCodes(w http.ResponseWriter, r *http.Request) (map[string]bool, bool) {
	list, err := s.store.ListDegrees(r.Context())
	if err != nil {
		s.internalError(w, "list degrees", err)
		return nil, false
	}
	out := map[string]bool{}
	for _, d := range list {
		out[d.Code] = true
	}
	return out, true
}

func sortedKeys(m map[string]bool) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}
