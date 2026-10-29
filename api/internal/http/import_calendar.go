package http

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/importer"
	"attendance-dashboard/api/internal/stats"
)

// markedDates says which degrees already have attendance on each date.
type markedDates map[string]map[string]bool

func (s *Server) loadMarkedDates(ctx context.Context, from, to time.Time) (markedDates, error) {
	rows, err := s.store.ListMarkedDatesByDegree(ctx, db.ListMarkedDatesByDegreeParams{FromDate: pgDate(from), ToDate: pgDate(to)})
	if err != nil {
		return nil, err
	}
	out := markedDates{}
	for _, r := range rows {
		k := stats.DateKey(r.Date.Time)
		if out[k] == nil {
			out[k] = map[string]bool{}
		}
		out[k][r.DegreeCode] = true
	}
	return out, nil
}

// has reports whether date has marks for students the scope applies to.
func (m markedDates) has(date, appliesTo string) bool {
	if appliesTo == "ALL" {
		return len(m[date]) > 0
	}
	return m[date][appliesTo]
}

// calendarEntry is one entry to save. Counts must already follow the day
// type rules (working: true; holiday, exam: false; event: as chosen).
type calendarEntry struct {
	Date      time.Time
	AppliesTo string
	DayType   string
	Counts    bool
	Label     string
}

// saveCalendarEntries upserts entries by (date, applies_to) in one
// transaction, reusing the range upsert with a one-day range.
func (s *Server) saveCalendarEntries(ctx context.Context, entries []calendarEntry) (int64, error) {
	var saved int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		for _, e := range entries {
			n, err := q.UpsertCalendarRange(ctx, db.UpsertCalendarRangeParams{
				AppliesTo: e.AppliesTo, DayType: e.DayType, Counts: e.Counts, Label: e.Label,
				FromDate: pgDate(e.Date), ToDate: pgDate(e.Date), SkipSundays: false,
			})
			if err != nil {
				return fmt.Errorf("%s %s: %w", stats.DateKey(e.Date), e.AppliesTo, err)
			}
			saved += n
		}
		return nil
	})
	return saved, err
}

type calendarImportRow struct {
	importer.CalendarRow
	Action string `json:"action"` // new, update, unchanged, error
}

type calendarImportResponse struct {
	FileName string `json:"file_name"`
	Summary  struct {
		Total     int `json:"total"`
		New       int `json:"new"`
		Updated   int `json:"updated"`
		Unchanged int `json:"unchanged"`
		Errors    int `json:"errors"`
		Warnings  int `json:"warnings"`
	} `json:"summary"`
	Rows      []calendarImportRow `json:"rows"`
	Committed bool                `json:"committed"`
	Saved     int64               `json:"saved"`
}

// POST /api/admin/imports/calendar (multipart field "file"): preview, or with
// commit=true save new and changed rows in one transaction. Errors block the
// save unless skip_errors=true. Upserts by (date, applies_to), so uploading
// the same file again changes nothing.
func (s *Server) handleImportCalendar(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, importer.MaxFileSize+1<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Choose a .xlsx or .csv file (max 10 MB) to upload.", nil)
		return
	}
	defer file.Close()
	commit := r.URL.Query().Get("commit") == "true"
	skipErrors := r.URL.Query().Get("skip_errors") == "true"

	table, err := importer.ReadTable(file, header.Filename)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_file", err.Error(), nil)
		return
	}
	degrees, ok := s.degreeCodes(w, r)
	if !ok {
		return
	}
	parsed, err := importer.ParseCalendar(table, degrees)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_file", err.Error(), nil)
		return
	}

	resp := calendarImportResponse{FileName: header.Filename, Rows: make([]calendarImportRow, len(parsed))}
	var from, to time.Time
	for _, p := range parsed {
		if len(p.Errors) == 0 {
			if from.IsZero() || p.Date.Before(from) {
				from = p.Date
			}
			if p.Date.After(to) {
				to = p.Date
			}
		}
	}
	existing := map[string]db.CalendarDay{}
	marked := markedDates{}
	if !from.IsZero() {
		days, err := s.store.ListCalendarDays(r.Context(), db.ListCalendarDaysParams{FromDate: pgDate(from), ToDate: pgDate(to)})
		if err != nil {
			s.internalError(w, "list calendar", err)
			return
		}
		for _, d := range days {
			existing[stats.DateKey(d.Date.Time)+"|"+d.AppliesTo] = d
		}
		if marked, err = s.loadMarkedDates(r.Context(), from, to); err != nil {
			s.internalError(w, "marked dates", err)
			return
		}
	}

	var toSave []calendarEntry
	for i, p := range parsed {
		row := calendarImportRow{CalendarRow: p}
		if len(p.Errors) > 0 {
			row.Action = "error"
			resp.Summary.Errors++
		} else {
			old, found := existing[p.DateText+"|"+p.AppliesTo]
			switch {
			case !found:
				row.Action = "new"
				resp.Summary.New++
			case old.DayType == p.DayType && old.Counts == p.Counts && old.Label == p.Label:
				row.Action = "unchanged"
				resp.Summary.Unchanged++
			default:
				row.Action = "update"
				resp.Summary.Updated++
				row.Warnings = append(row.Warnings, fmt.Sprintf("Replaces the saved entry (%s%s).", old.DayType, labelSuffix(old.Label)))
			}
			if row.Action != "unchanged" && marked.has(p.DateText, p.AppliesTo) {
				row.Warnings = append(row.Warnings, "This date already has attendance marks. They are kept, but whether they count follows this entry.")
			}
			if row.Action != "unchanged" {
				toSave = append(toSave, calendarEntry{Date: p.Date, AppliesTo: p.AppliesTo, DayType: p.DayType, Counts: p.Counts, Label: p.Label})
			}
		}
		if len(row.Warnings) > 0 {
			resp.Summary.Warnings++
		}
		resp.Rows[i] = row
	}
	resp.Summary.Total = len(parsed)

	if !commit {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	if resp.Summary.Errors > 0 && !skipErrors {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed",
			fmt.Sprintf("%d row(s) have errors. Fix them, or choose to skip those rows.", resp.Summary.Errors), resp)
		return
	}
	if resp.Saved, err = s.saveCalendarEntries(r.Context(), toSave); err != nil {
		s.internalError(w, "save calendar import", err)
		return
	}
	resp.Committed = true
	s.log.Info("calendar import committed", "admin_id", adminFrom(r.Context()).ID, "saved", resp.Saved, "file", header.Filename)
	writeJSON(w, http.StatusOK, resp)
}

type entryInput struct {
	Date      string `json:"date"`
	AppliesTo string `json:"applies_to"`
	DayType   string `json:"day_type"`
	Counts    *bool  `json:"counts"`
	Label     string `json:"label"`
}

// PUT /api/admin/calendar/entries [{date, applies_to, day_type, counts?, label}]:
// saves a list of single-date entries in one transaction, e.g. the missing
// dates an admin picked from an attendance import preview. Any invalid entry
// means nothing is saved (422 with per-entry errors).
func (s *Server) handleSaveCalendarEntries(w http.ResponseWriter, r *http.Request) {
	var in []entryInput
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in) == 0 || len(in) > 400 {
		writeError(w, http.StatusBadRequest, "bad_request", "Send between 1 and 400 entries.", nil)
		return
	}
	degrees, ok := s.degreeCodes(w, r)
	if !ok {
		return
	}
	var errs []rowError
	entries := make([]calendarEntry, 0, len(in))
	seen := map[string]bool{}
	var from, to time.Time
	for i, e := range in {
		fail := func(msg string) { errs = append(errs, rowError{Index: i, NiatID: e.Date, Message: msg}) }
		date, err := parseDate(e.Date)
		applies := strings.ToUpper(strings.TrimSpace(e.AppliesTo))
		kind := strings.ToLower(strings.TrimSpace(e.DayType))
		label := strings.Join(strings.Fields(e.Label), " ")
		switch {
		case err != nil:
			fail(err.Error())
		case applies != "ALL" && !degrees[applies]:
			fail("Applies to must be All or a degree (BITS, CDU).")
		case kind != "working" && kind != "holiday" && kind != "exam" && kind != "event":
			fail("Day type must be working, holiday, exam or event.")
		case len(label) > 100:
			fail("The label can be up to 100 characters.")
		case seen[e.Date+"|"+applies]:
			fail("The same date and scope appear twice.")
		default:
			seen[e.Date+"|"+applies] = true
			counts := kind == "working" || (kind == "event" && (e.Counts == nil || *e.Counts))
			entries = append(entries, calendarEntry{Date: date, AppliesTo: applies, DayType: kind, Counts: counts, Label: label})
			if from.IsZero() || date.Before(from) {
				from = date
			}
			if date.After(to) {
				to = date
			}
		}
	}
	if len(errs) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", fmt.Sprintf("%d entr(ies) are invalid; nothing was saved.", len(errs)), errs)
		return
	}
	saved, err := s.saveCalendarEntries(r.Context(), entries)
	if err != nil {
		s.internalError(w, "save calendar entries", err)
		return
	}
	resp := map[string]any{"saved": saved}
	marked, err := s.loadMarkedDates(r.Context(), from, to)
	if err != nil {
		s.internalError(w, "marked dates", err)
		return
	}
	n := 0
	for _, e := range entries {
		if marked.has(stats.DateKey(e.Date), e.AppliesTo) {
			n++
		}
	}
	if n > 0 {
		resp["warning"] = fmt.Sprintf("%d of these date(s) already have attendance marks. The marks are kept; whether they count follows the new entries.", n)
	}
	s.log.Info("calendar entries saved", "admin_id", adminFrom(r.Context()).ID, "saved", saved)
	writeJSON(w, http.StatusOK, resp)
}

type missingDate struct {
	Date     string              `json:"date"`
	Weekday  int                 `json:"weekday"`
	Entries  []calendarEntryJSON `json:"entries"`   // calendar entries already saved for this date
	HasMarks bool                `json:"has_marks"` // attendance already recorded on this date (any degree)
}

// missingDates lists every non-Sunday date between the first and last date
// column that has no column of its own. They are suggestions only: a missing
// column does not prove the day was a holiday.
func (s *Server) missingDates(ctx context.Context, dates []string) ([]missingDate, error) {
	out := []missingDate{}
	if len(dates) < 2 {
		return out, nil
	}
	have := map[string]bool{}
	for _, d := range dates {
		have[d] = true
	}
	first, _ := parseDate(dates[0])
	last, _ := parseDate(dates[len(dates)-1])
	var gaps []time.Time
	for d := first.AddDate(0, 0, 1); d.Before(last); d = d.AddDate(0, 0, 1) {
		if d.Weekday() != time.Sunday && !have[stats.DateKey(d)] {
			gaps = append(gaps, d)
		}
	}
	if len(gaps) == 0 {
		return out, nil
	}
	stored, err := s.store.ListCalendarDays(ctx, db.ListCalendarDaysParams{FromDate: pgDate(gaps[0]), ToDate: pgDate(gaps[len(gaps)-1])})
	if err != nil {
		return nil, err
	}
	byDate := map[string][]calendarEntryJSON{}
	for _, e := range stored {
		k := stats.DateKey(e.Date.Time)
		byDate[k] = append(byDate[k], calendarEntryJSON{AppliesTo: e.AppliesTo, DayType: e.DayType, Counts: e.Counts, Label: e.Label})
	}
	marked, err := s.loadMarkedDates(ctx, gaps[0], gaps[len(gaps)-1])
	if err != nil {
		return nil, err
	}
	for _, d := range gaps {
		k := stats.DateKey(d)
		entries := byDate[k]
		if entries == nil {
			entries = []calendarEntryJSON{}
		}
		out = append(out, missingDate{Date: k, Weekday: int(d.Weekday()), Entries: entries, HasMarks: marked.has(k, "ALL")})
	}
	return out, nil
}
