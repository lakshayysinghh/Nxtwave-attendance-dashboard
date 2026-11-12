package http

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/stats"
)

// Deleting calendar entries. Every deletion is previewed first: the preview
// lists the exact entries and how the attendance calendar changes, and
// returns a token. The delete must send that token; it is checked again on
// the locked rows, so a deletion removes exactly what was shown. Deleted
// entries are archived (restorable) and the deletion is recorded. Students,
// attendance marks and internship / registration periods are never touched.

// importSources are the sources an imported-entry reset may remove.
var importSources = map[string]bool{"calendar_import": true, "attendance_import": true, "students_import": true}

type entryKey struct {
	Date      string `json:"date"`
	AppliesTo string `json:"applies_to"`
}

// deletionSelector says which entries to delete.
//   - mode "selected": exactly the listed entries, whatever their source.
//   - mode "imported": entries from imports only (never manual or legacy),
//     narrowed by uploads, scopes, types and a date range. Owner only.
type deletionSelector struct {
	Mode     string     `json:"mode"`
	Entries  []entryKey `json:"entries,omitempty"`
	BatchIDs []int64    `json:"batch_ids,omitempty"`
	Degrees  []string   `json:"degrees,omitempty"` // ALL, BITS, CDU
	Types    []string   `json:"types,omitempty"`
	From     string     `json:"from,omitempty"`
	To       string     `json:"to,omitempty"`
}

func (sel *deletionSelector) validate(degrees map[string]bool) error {
	switch sel.Mode {
	case "selected":
		if len(sel.Entries) == 0 || len(sel.Entries) > 2000 {
			return userMsg("Select between 1 and 2000 entries.")
		}
		for i, e := range sel.Entries {
			if _, err := parseDate(e.Date); err != nil {
				return err
			}
			sel.Entries[i].AppliesTo = strings.ToUpper(strings.TrimSpace(e.AppliesTo))
		}
	case "imported":
		for i, d := range sel.Degrees {
			d = strings.ToUpper(strings.TrimSpace(d))
			if d != "ALL" && !degrees[d] {
				return userMsg(fmt.Sprintf("Unknown degree %q.", d))
			}
			sel.Degrees[i] = d
		}
		for _, t := range sel.Types {
			switch stats.Kind(t) {
			case stats.KindWorking, stats.KindHoliday, stats.KindExam, stats.KindExamPrep, stats.KindEvent:
			default:
				return userMsg(fmt.Sprintf("Unknown day type %q.", t))
			}
		}
		for _, d := range []string{sel.From, sel.To} {
			if d == "" {
				continue
			}
			if _, err := parseDate(d); err != nil {
				return err
			}
		}
		if sel.From != "" && sel.To != "" && sel.To < sel.From {
			return userMsg("The end date must be on or after the start date.")
		}
	default:
		return userMsg(`mode must be "selected" or "imported".`)
	}
	return nil
}

// userMsg is a validation message shown to the admin as is.
type userMsg string

func (m userMsg) Error() string { return string(m) }

type excludedCounts struct {
	Manual int `json:"manual"`
	Legacy int `json:"legacy"`
}

func contains[T comparable](xs []T, x T) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// selectEntries applies the selector. For "imported" it also counts the
// manual and legacy entries the same filters would have matched, so the
// preview can say they are kept. missing counts selected entries that no
// longer exist.
func selectEntries(rows []db.ListCalendarEntriesRow, sel deletionSelector) (picked []db.ListCalendarEntriesRow, kept excludedCounts, missing int) {
	if sel.Mode == "selected" {
		want := map[entryKey]bool{}
		for _, e := range sel.Entries {
			want[e] = true
		}
		for _, r := range rows {
			if want[entryKey{stats.DateKey(r.Date.Time), r.AppliesTo}] {
				picked = append(picked, r)
			}
		}
		return picked, kept, len(want) - len(picked)
	}
	for _, r := range rows {
		d := stats.DateKey(r.Date.Time)
		switch {
		case len(sel.BatchIDs) > 0 && (!r.BatchID.Valid || !contains(sel.BatchIDs, r.BatchID.Int64)),
			len(sel.Degrees) > 0 && !contains(sel.Degrees, r.AppliesTo),
			len(sel.Types) > 0 && !contains(sel.Types, r.DayType),
			sel.From != "" && d < sel.From,
			sel.To != "" && d > sel.To:
			continue
		}
		switch {
		case importSources[r.Source]:
			picked = append(picked, r)
		case r.Source == "manual":
			kept.Manual++
		default:
			kept.Legacy++
		}
	}
	return picked, kept, 0
}

// entriesToken fingerprints the exact rows (and their last change), so an
// action only goes ahead on what was previewed.
func entriesToken(rows []db.ListCalendarEntriesRow) string {
	keys := make([]string, len(rows))
	for i, r := range rows {
		keys[i] = fmt.Sprintf("%s|%s|%s|%v|%s|%s|%d|%v", stats.DateKey(r.Date.Time), r.AppliesTo, r.DayType, r.Counts, r.Label, r.Source,
			r.BatchID.Int64, r.UpdatedAt.Time.UnixMicro())
	}
	sort.Strings(keys)
	h := sha256.Sum256([]byte(strings.Join(keys, "\n")))
	return hex.EncodeToString(h[:16])
}

func calendarEntries(rows []db.ListCalendarEntriesRow) []stats.CalendarEntry {
	out := make([]stats.CalendarEntry, len(rows))
	for i, r := range rows {
		out[i] = stats.CalendarEntry{Date: r.Date.Time, AppliesTo: r.AppliesTo, DayType: stats.Kind(r.DayType), Counts: r.Counts, Label: r.Label}
	}
	return out
}

type impactDay struct {
	Kind    string `json:"kind"`
	Label   string `json:"label"`
	Counts  bool   `json:"counts"`  // the calendar makes it a class day
	Counted bool   `json:"counted"` // and it counts now (inside a term, not in the future)
}

type impactChange struct {
	Date            string    `json:"date"`
	Degree          string    `json:"degree"`
	Before          impactDay `json:"before"`
	After           impactDay `json:"after"`
	CountingChanges bool      `json:"counting_changes"`
	Marks           int64     `json:"marks"` // saved marks on that date for that degree's students
}

type impactJSON struct {
	Changes []impactChange `json:"changes"`
	// StartCounting / StopCounting are the (date, degree) pairs whose saved
	// marks start or stop counting, and the marks on them.
	StartCounting int   `json:"start_counting"`
	StopCounting  int   `json:"stop_counting"`
	MarksStart    int64 `json:"marks_start"`
	MarksStop     int64 `json:"marks_stop"`
}

func toImpactDay(d stats.Day) impactDay {
	return impactDay{Kind: string(d.Kind), Label: d.Label, Counts: d.DayCounts(), Counted: d.Counted}
}

// calendarImpact explains what removing (or changing) entries does to each
// degree's days, with the saved marks on those dates. Marks are not changed.
func (s *Server) calendarImpact(ctx context.Context, q db.Querier, all []stats.CalendarEntry, after []stats.CalendarEntry, dates []time.Time, degrees map[string]bool) (impactJSON, error) {
	out := impactJSON{Changes: []impactChange{}}
	if len(dates) == 0 {
		return out, nil
	}
	dbTerms, err := q.ListTerms(ctx)
	if err != nil {
		return out, err
	}
	terms := make([]stats.Term, len(dbTerms))
	for i, t := range dbTerms {
		terms[i] = stats.Term{ID: t.ID, Name: t.Name, Start: t.StartDate.Time, End: t.EndDate.Time, IsCurrent: t.IsCurrent}
	}
	codes := make([]string, 0, len(degrees))
	for c := range degrees {
		codes = append(codes, c)
	}
	changes := stats.CalendarImpact(dates, codes, stats.NewCalendar(all), stats.NewCalendar(after), terms, stats.TodayIST(s.now()))
	if len(changes) == 0 {
		return out, nil
	}
	from, to := changes[0].Date, changes[0].Date
	for _, c := range changes {
		if c.Date.Before(from) {
			from = c.Date
		}
		if c.Date.After(to) {
			to = c.Date
		}
	}
	counts, err := q.CountMarksByDateAndDegree(ctx, db.CountMarksByDateAndDegreeParams{FromDate: pgDate(from), ToDate: pgDate(to)})
	if err != nil {
		return out, err
	}
	marks := map[string]int64{}
	for _, c := range counts {
		marks[stats.DateKey(c.Date.Time)+"|"+c.DegreeCode] = c.Marks
	}
	for _, c := range changes {
		ch := impactChange{
			Date: stats.DateKey(c.Date), Degree: c.Degree, Before: toImpactDay(c.Before), After: toImpactDay(c.After),
			CountingChanges: c.CountingChanged(), Marks: marks[stats.DateKey(c.Date)+"|"+c.Degree],
		}
		if ch.CountingChanges && ch.After.Counted {
			out.StartCounting++
			out.MarksStart += ch.Marks
		} else if ch.CountingChanges {
			out.StopCounting++
			out.MarksStop += ch.Marks
		}
		out.Changes = append(out.Changes, ch)
	}
	return out, nil
}

type deletionPreview struct {
	Entries []entryRange   `json:"entries"`
	Count   int            `json:"count"`
	Dates   []string       `json:"dates"`
	Degrees []string       `json:"degrees"`
	Types   map[string]int `json:"types"`
	Kept    excludedCounts `json:"kept"`
	Missing int            `json:"missing"`
	Impact  impactJSON     `json:"impact"`
	Token   string         `json:"token"`
}

func (s *Server) buildDeletionPreview(ctx context.Context, q db.Querier, rows []db.ListCalendarEntriesRow, sel deletionSelector, degrees map[string]bool) (deletionPreview, []db.ListCalendarEntriesRow, error) {
	picked, kept, missing := selectEntries(rows, sel)
	p := deletionPreview{Entries: groupEntries(picked), Count: len(picked), Dates: []string{}, Degrees: []string{}, Types: map[string]int{},
		Kept: kept, Missing: missing, Token: entriesToken(picked)}
	seenDate, seenDeg := map[string]bool{}, map[string]bool{}
	var dates []time.Time
	for _, r := range picked {
		k := stats.DateKey(r.Date.Time)
		if !seenDate[k] {
			seenDate[k] = true
			p.Dates = append(p.Dates, k)
			dates = append(dates, r.Date.Time)
		}
		if !seenDeg[r.AppliesTo] {
			seenDeg[r.AppliesTo] = true
			p.Degrees = append(p.Degrees, r.AppliesTo)
		}
		p.Types[r.DayType]++
	}
	sort.Strings(p.Dates)
	sort.Strings(p.Degrees)
	all := calendarEntries(rows)
	impact, err := s.calendarImpact(ctx, q, all, stats.Without(all, calendarEntries(picked)), dates, degrees)
	p.Impact = impact
	// The token also covers the impact shown, so a calendar change that alters
	// what the deletion does (not only which rows it removes) needs a new preview.
	raw, _ := json.Marshal(impact.Changes)
	h := sha256.Sum256(append([]byte(p.Token), raw...))
	p.Token = hex.EncodeToString(h[:16])
	return p, picked, err
}

// decodeLarge reads a JSON body up to 512 KB (long entry selections).
func decodeLarge(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(dst); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "The request body is not valid JSON.", nil)
		return false
	}
	return true
}

// ownerFor writes a 403 when an imported-entry reset is asked for by an admin
// who is not an Owner.
func ownerFor(w http.ResponseWriter, r *http.Request, mode string) bool {
	if mode == "imported" && adminFrom(r.Context()).Role != "owner" {
		writeError(w, http.StatusForbidden, "forbidden", "Only the Owner can reset imported calendar entries.", nil)
		return false
	}
	return true
}

// POST /api/admin/calendar/deletions/preview {selector}: what a deletion
// would remove and how attendance days change. Changes nothing.
func (s *Server) handlePreviewCalendarDeletion(w http.ResponseWriter, r *http.Request) {
	var sel deletionSelector
	if !decodeLarge(w, r, &sel) {
		return
	}
	degrees, ok := s.degreeCodes(w, r)
	if !ok {
		return
	}
	if err := sel.validate(degrees); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_selection", err.Error(), nil)
		return
	}
	if !ownerFor(w, r, sel.Mode) {
		return
	}
	rows, err := s.store.ListCalendarEntries(r.Context())
	if err != nil {
		s.internalError(w, "list calendar entries", err)
		return
	}
	p, _, err := s.buildDeletionPreview(r.Context(), s.store, rows, sel, degrees)
	if err != nil {
		s.internalError(w, "deletion preview", err)
		return
	}
	writeJSON(w, http.StatusOK, p)
}

type deletionRequest struct {
	deletionSelector
	Token     string `json:"token"`
	Confirmed bool   `json:"confirmed"` // selected mode
	Confirm   string `json:"confirm"`   // imported mode: "RESET <count>"
}

var errCalendarChanged = errors.New("calendar changed")

// POST /api/admin/calendar/deletions {selector, token, confirmed | confirm}:
// archives and deletes exactly the previewed entries in one transaction.
func (s *Server) handleDeleteCalendarEntries(w http.ResponseWriter, r *http.Request) {
	var in deletionRequest
	if !decodeLarge(w, r, &in) {
		return
	}
	degrees, ok := s.degreeCodes(w, r)
	if !ok {
		return
	}
	sel := in.deletionSelector
	if err := sel.validate(degrees); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_selection", err.Error(), nil)
		return
	}
	if !ownerFor(w, r, sel.Mode) {
		return
	}
	if in.Token == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "Preview the deletion first.", nil)
		return
	}
	admin := adminFrom(r.Context())
	var res struct {
		DeletionID int64      `json:"deletion_id"`
		Deleted    int        `json:"deleted"`
		Impact     impactJSON `json:"impact"`
	}
	err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		locked, err := q.ListCalendarEntriesForUpdate(r.Context())
		if err != nil {
			return err
		}
		rows := make([]db.ListCalendarEntriesRow, len(locked))
		for i, l := range locked {
			rows[i] = db.ListCalendarEntriesRow(l)
		}
		p, picked, err := s.buildDeletionPreview(r.Context(), q, rows, sel, degrees)
		if err != nil {
			return err
		}
		if p.Token != in.Token || p.Count == 0 {
			return errCalendarChanged
		}
		if sel.Mode == "imported" && strings.ToUpper(strings.TrimSpace(in.Confirm)) != fmt.Sprintf("RESET %d", p.Count) {
			return errConfirm{fmt.Sprintf("Type RESET %d to confirm.", p.Count)}
		}
		if sel.Mode == "selected" && !in.Confirmed {
			return errConfirm{"Confirm the deletion."}
		}
		criteria, _ := json.Marshal(map[string]any{"selector": sel, "dates": p.Dates, "degrees": p.Degrees, "types": p.Types, "kept": p.Kept,
			"impact": map[string]any{"start_counting": p.Impact.StartCounting, "stop_counting": p.Impact.StopCounting, "marks_start": p.Impact.MarksStart, "marks_stop": p.Impact.MarksStop}})
		d, err := q.InsertCalendarDeletion(r.Context(), db.InsertCalendarDeletionParams{
			Kind: sel.Mode, Criteria: criteria, EntryCount: int32(p.Count), DeletedBy: optInt8(admin.ID), DeletedByEmail: admin.Email,
		})
		if err != nil {
			return err
		}
		dates, applies := keysOf(picked)
		n, err := q.ArchiveCalendarEntries(r.Context(), db.ArchiveCalendarEntriesParams{DeletionID: d.ID, Dates: dates, AppliesTo: applies})
		if err != nil {
			return err
		}
		m, err := q.DeleteCalendarEntriesByKeys(r.Context(), db.DeleteCalendarEntriesByKeysParams{Dates: dates, AppliesTo: applies})
		if err != nil {
			return err
		}
		if int(n) != p.Count || int(m) != p.Count {
			return fmt.Errorf("archived %d and deleted %d of %d entries", n, m, p.Count)
		}
		res.DeletionID, res.Deleted, res.Impact = d.ID, p.Count, p.Impact
		return nil
	})
	var ce errConfirm
	switch {
	case errors.Is(err, errCalendarChanged):
		writeError(w, http.StatusConflict, "calendar_changed", "The calendar changed since the preview (or nothing matches any more). Nothing was deleted; check the preview again.", nil)
		return
	case errors.As(err, &ce):
		writeError(w, http.StatusUnprocessableEntity, "confirmation_required", ce.msg, nil)
		return
	case err != nil:
		s.internalError(w, "delete calendar entries", err)
		return
	}
	s.log.Info("calendar entries deleted", "admin_id", admin.ID, "mode", sel.Mode, "deleted", res.Deleted, "deletion_id", res.DeletionID)
	writeJSON(w, http.StatusOK, res)
}

type errConfirm struct{ msg string }

func (e errConfirm) Error() string { return e.msg }

func keysOf(rows []db.ListCalendarEntriesRow) ([]pgtype.Date, []string) {
	dates := make([]pgtype.Date, len(rows))
	applies := make([]string, len(rows))
	for i, r := range rows {
		dates[i], applies[i] = r.Date, r.AppliesTo
	}
	return dates, applies
}

type entryEdit struct {
	Entries []entryKey `json:"entries"`
	Token   string     `json:"token"`
	DayType string     `json:"day_type"`
	Counts  *bool      `json:"counts"`
	Label   string     `json:"label"`
}

// PATCH /api/admin/calendar/entries {entries, token, day_type, counts?, label}:
// corrects existing entries in place. They become manual entries (so an
// imported-entry reset no longer removes them) and the edit is recorded.
func (s *Server) handleEditCalendarEntries(w http.ResponseWriter, r *http.Request) {
	var in entryEdit
	if !decodeLarge(w, r, &in) {
		return
	}
	degrees, ok := s.degreeCodes(w, r)
	if !ok {
		return
	}
	sel := deletionSelector{Mode: "selected", Entries: in.Entries}
	if err := sel.validate(degrees); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_selection", err.Error(), nil)
		return
	}
	kind := stats.Kind(strings.ToLower(strings.TrimSpace(in.DayType)))
	counts := false
	switch kind {
	case stats.KindWorking:
		counts = true
	case stats.KindHoliday, stats.KindExam, stats.KindExamPrep:
	case stats.KindEvent:
		counts = in.Counts == nil || *in.Counts
	default:
		writeError(w, http.StatusUnprocessableEntity, "invalid_day_type", "Day type must be working, holiday, exam, exam_prep or event.", nil)
		return
	}
	label := strings.Join(strings.Fields(in.Label), " ")
	if len(label) > 100 {
		writeError(w, http.StatusUnprocessableEntity, "invalid_label", "The label can be up to 100 characters.", nil)
		return
	}
	admin := adminFrom(r.Context())
	var res struct {
		Updated int        `json:"updated"`
		Impact  impactJSON `json:"impact"`
	}
	err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		locked, err := q.ListCalendarEntriesForUpdate(r.Context())
		if err != nil {
			return err
		}
		rows := make([]db.ListCalendarEntriesRow, len(locked))
		for i, l := range locked {
			rows[i] = db.ListCalendarEntriesRow(l)
		}
		picked, _, missing := selectEntries(rows, sel)
		if missing > 0 || entriesToken(picked) != in.Token {
			return errCalendarChanged
		}
		all := calendarEntries(rows)
		after := stats.Without(all, calendarEntries(picked))
		var dates []time.Time
		for _, p := range picked {
			after = append(after, stats.CalendarEntry{Date: p.Date.Time, AppliesTo: p.AppliesTo, DayType: kind, Counts: counts, Label: label})
			dates = append(dates, p.Date.Time)
		}
		if res.Impact, err = s.calendarImpact(r.Context(), q, all, after, dates, degrees); err != nil {
			return err
		}
		ds, applies := keysOf(picked)
		n, err := q.UpdateCalendarEntriesByKeys(r.Context(), db.UpdateCalendarEntriesByKeysParams{
			DayType: string(kind), Counts: counts, Label: label, AdminID: optInt8(admin.ID), Dates: ds, AppliesTo: applies,
		})
		res.Updated = int(n)
		return err
	})
	if errors.Is(err, errCalendarChanged) {
		writeError(w, http.StatusConflict, "calendar_changed", "This entry changed since you opened it. Nothing was saved; open it again.", nil)
		return
	}
	if err != nil {
		s.internalError(w, "edit calendar entries", err)
		return
	}
	s.log.Info("calendar entries edited", "admin_id", admin.ID, "updated", res.Updated)
	writeJSON(w, http.StatusOK, res)
}

type deletionJSON struct {
	ID              int64           `json:"id"`
	Kind            string          `json:"kind"`
	Criteria        json.RawMessage `json:"criteria"`
	EntryCount      int32           `json:"entry_count"`
	DeletedAt       time.Time       `json:"deleted_at"`
	DeletedBy       *adminRef       `json:"deleted_by"`
	RestoredAt      *time.Time      `json:"restored_at"`
	RestoredBy      *adminRef       `json:"restored_by"`
	RestoredEntries int64           `json:"restored_entries"`
}

// GET /api/admin/calendar/deletions: the deletion log, newest first.
func (s *Server) handleListCalendarDeletions(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListCalendarDeletions(r.Context())
	if err != nil {
		s.internalError(w, "list calendar deletions", err)
		return
	}
	out := make([]deletionJSON, len(rows))
	for i, d := range rows {
		by := &adminRef{Name: d.DeletedByName.String, Email: d.DeletedByEmail}
		out[i] = deletionJSON{
			ID: d.ID, Kind: d.Kind, Criteria: d.Criteria, EntryCount: d.EntryCount, DeletedAt: d.DeletedAt.Time.UTC(), DeletedBy: by,
			RestoredAt: optTime(d.RestoredAt), RestoredBy: optAdmin(d.RestoredByName, d.RestoredByEmail), RestoredEntries: d.RestoredEntries,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"deletions": out})
}

func deletionID(w http.ResponseWriter, r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil || id <= 0 {
		writeError(w, http.StatusBadRequest, "bad_request", "Unknown deletion.", nil)
		return 0, false
	}
	return id, true
}

// GET /api/admin/calendar/deletions/{id}: the entries a deletion removed.
func (s *Server) handleGetCalendarDeletion(w http.ResponseWriter, r *http.Request) {
	id, ok := deletionID(w, r)
	if !ok {
		return
	}
	rows, err := s.store.ListDeletedEntries(r.Context(), id)
	if err != nil {
		s.internalError(w, "list deleted entries", err)
		return
	}
	type deleted struct {
		Date      string `json:"date"`
		AppliesTo string `json:"applies_to"`
		DayType   string `json:"day_type"`
		Counts    bool   `json:"counts"`
		Label     string `json:"label"`
		Source    string `json:"source"`
		FileName  string `json:"file_name"`
		Restored  bool   `json:"restored"`
	}
	out := make([]deleted, len(rows))
	for i, e := range rows {
		out[i] = deleted{stats.DateKey(e.Date.Time), e.AppliesTo, e.DayType, e.Counts, e.Label, e.Source, e.BatchFileName.String, e.Restored}
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": out})
}

// POST /api/admin/calendar/deletions/{id}/restore: puts back the deleted
// entries whose date and scope are still free; newer entries are kept.
// Restoring a reset of imported entries is for the Owner.
func (s *Server) handleRestoreCalendarDeletion(w http.ResponseWriter, r *http.Request) {
	id, ok := deletionID(w, r)
	if !ok {
		return
	}
	admin := adminFrom(r.Context())
	var res struct {
		Restored int `json:"restored"`
		Skipped  int `json:"skipped"`
	}
	err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		d, err := q.LockCalendarDeletion(r.Context(), id)
		if err != nil {
			return err
		}
		if d.Kind == "imported" && admin.Role != "owner" {
			return errForbidden
		}
		rows, err := q.RestoreDeletedEntries(r.Context(), id)
		if err != nil {
			return err
		}
		dates := make([]pgtype.Date, len(rows))
		applies := make([]string, len(rows))
		for i, x := range rows {
			dates[i], applies[i] = x.Date, x.AppliesTo
		}
		if err := q.MarkDeletedEntriesRestored(r.Context(), db.MarkDeletedEntriesRestoredParams{DeletionID: id, Dates: dates, AppliesTo: applies}); err != nil {
			return err
		}
		left, err := q.ListDeletedEntries(r.Context(), id)
		if err != nil {
			return err
		}
		for _, e := range left {
			if !e.Restored {
				res.Skipped++
			}
		}
		res.Restored = len(rows)
		if len(rows) > 0 {
			return q.SetCalendarDeletionRestored(r.Context(), db.SetCalendarDeletionRestoredParams{ID: id, AdminID: optInt8(admin.ID)})
		}
		return nil
	})
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		writeError(w, http.StatusNotFound, "not_found", "Unknown deletion.", nil)
		return
	case errors.Is(err, errForbidden):
		writeError(w, http.StatusForbidden, "forbidden", "Only the Owner can restore a reset of imported entries.", nil)
		return
	case err != nil:
		s.internalError(w, "restore calendar deletion", err)
		return
	}
	s.log.Info("calendar deletion restored", "admin_id", admin.ID, "deletion_id", id, "restored", res.Restored, "skipped", res.Skipped)
	writeJSON(w, http.StatusOK, res)
}

var errForbidden = errors.New("forbidden")
