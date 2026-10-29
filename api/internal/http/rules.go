package http

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/stats"
)

// calendarStart and calendarEnd bound "the whole calendar": a few hundred rows.
var (
	calendarStart = stats.Date(2000, 1, 1)
	calendarEnd   = stats.Date(2100, 1, 1)
)

// rules is everything stats needs about the calendar for one request.
type rules struct {
	today time.Time
	terms []stats.Term
	cal   stats.Calendar
	term  stats.Term // current term; zero when has is false
	has   bool
}

func (s *Server) loadRules(ctx context.Context, from, to time.Time) (rules, error) {
	r := rules{today: stats.TodayIST(s.now())}
	dbTerms, err := s.store.ListTerms(ctx)
	if err != nil {
		return r, fmt.Errorf("list terms: %w", err)
	}
	for _, t := range dbTerms {
		r.terms = append(r.terms, stats.Term{ID: t.ID, Name: t.Name, Start: t.StartDate.Time, End: t.EndDate.Time, IsCurrent: t.IsCurrent})
	}
	r.term, r.has = stats.CurrentTerm(r.terms, r.today)

	days, err := s.store.ListCalendarDays(ctx, db.ListCalendarDaysParams{FromDate: pgDate(from), ToDate: pgDate(to)})
	if err != nil {
		return r, fmt.Errorf("list calendar: %w", err)
	}
	entries := make([]stats.CalendarEntry, len(days))
	for i, d := range days {
		entries[i] = stats.CalendarEntry{Date: d.Date.Time, AppliesTo: d.AppliesTo, DayType: stats.Kind(d.DayType), Counts: d.Counts, Label: d.Label}
	}
	r.cal = stats.NewCalendar(entries)
	return r, nil
}

// termRange is the current term's dates, or the 30 days up to today without a term.
func (r rules) termRange() (time.Time, time.Time) {
	if r.has {
		return r.term.Start, r.term.End
	}
	return r.today.AddDate(0, 0, -30), r.today
}

// statsStudent converts the student fields the rules need.
func statsStudent(degree, status string, joinedOn, droppedOn pgtype.Date) stats.Student {
	st := stats.Student{Degree: degree}
	if joinedOn.Valid {
		j := joinedOn.Time
		st.JoinedOn = &j
	}
	if status == "dropped" && droppedOn.Valid {
		d := droppedOn.Time
		st.DroppedOn = &d
	}
	return st
}

func (s *Server) loadMarks(ctx context.Context, ids []string, from, to time.Time) (map[string]stats.Marks, error) {
	rows, err := s.store.ListMarks(ctx, db.ListMarksParams{NiatIds: ids, FromDate: pgDate(from), ToDate: pgDate(to)})
	if err != nil {
		return nil, fmt.Errorf("list marks: %w", err)
	}
	out := make(map[string]stats.Marks, len(ids))
	for _, m := range rows {
		if out[m.NiatID] == nil {
			out[m.NiatID] = stats.Marks{}
		}
		out[m.NiatID][stats.DateKey(m.Date.Time)] = statusFromDB(m.Status)
	}
	return out, nil
}

func statusFromDB(s string) stats.Status {
	switch s {
	case "P":
		return stats.Present
	case "A":
		return stats.Absent
	}
	return stats.NotMarked
}

// markJSON is a day's mark on the wire: "P", "A" or null.
func markJSON(st stats.Status) *string {
	var v string
	switch st {
	case stats.Present:
		v = "P"
	case stats.Absent:
		v = "A"
	default:
		return nil
	}
	return &v
}

func parseDate(s string) (time.Time, error) {
	t, err := time.Parse(time.DateOnly, s)
	if err != nil {
		return time.Time{}, fmt.Errorf("%q is not a date like 2026-10-28", s)
	}
	return t, nil
}

func pgDate(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }

func optText(t pgtype.Text) string {
	if !t.Valid {
		return ""
	}
	return t.String
}

// likePattern escapes LIKE wildcards so user input matches literally.
func likePattern(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

// notCountedReason explains, for an admin, why a day cannot be marked.
func notCountedReason(day stats.Day) string {
	when := day.Date.Format("Mon 2 Jan 2006")
	switch day.Excluded {
	case stats.Future:
		return when + " is in the future."
	case stats.OutsideTerm:
		return when + " is outside the term."
	case stats.BeforeJoin:
		return when + " is before the student joined."
	case stats.AfterDrop:
		return when + " is after the student was dropped."
	}
	switch day.Kind {
	case stats.KindSunday:
		return when + " is a Sunday."
	case stats.KindHoliday:
		return when + " is a holiday" + labelSuffix(day.Label) + "."
	case stats.KindExam:
		return when + " is an exam day" + labelSuffix(day.Label) + "."
	case stats.KindEvent:
		return when + " is an event that does not count" + labelSuffix(day.Label) + "."
	}
	return when + " does not count."
}

func labelSuffix(label string) string {
	if label == "" {
		return ""
	}
	return " (" + label + ")"
}
