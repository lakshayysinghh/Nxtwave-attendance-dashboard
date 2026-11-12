package http

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/stats"
)

// adminRef names the admin who saved something; nil when unknown.
type adminRef struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

func optAdmin(name, email pgtype.Text) *adminRef {
	if !name.Valid {
		return nil
	}
	return &adminRef{Name: name.String, Email: email.String}
}

func optTime(t pgtype.Timestamptz) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time.UTC()
	return &v
}

type batchRef struct {
	ID       int64  `json:"id"`
	FileName string `json:"file_name"`
	Kind     string `json:"kind"`
}

// entryRange is consecutive calendar days saved together: same scope, type,
// counts, label, source, batch, authors and times. Sundays are skipped over
// when the range was saved without them, so Days can be less than the span.
type entryRange struct {
	Start     string     `json:"start"`
	End       string     `json:"end"`
	Days      int        `json:"days"`
	AppliesTo string     `json:"applies_to"`
	DayType   string     `json:"day_type"`
	Counts    bool       `json:"counts"`
	Label     string     `json:"label"`
	Source    string     `json:"source"` // legacy, manual, calendar_import, attendance_import, students_import
	Batch     *batchRef  `json:"batch"`
	CreatedAt *time.Time `json:"created_at"`
	UpdatedAt *time.Time `json:"updated_at"`
	CreatedBy *adminRef  `json:"created_by"`
	UpdatedBy *adminRef  `json:"updated_by"`
	// Dates are the exact entry dates; Token fingerprints the rows, for an
	// edit or deletion of exactly this range.
	Dates []string `json:"dates"`
	Token string   `json:"token"`

	last time.Time
	key  string
	rows []db.ListCalendarEntriesRow
}

// rangeKey is everything that must match for two days to share a range.
func rangeKey(e db.ListCalendarEntriesRow) string {
	b, _ := json.Marshal([]any{e.AppliesTo, e.DayType, e.Counts, e.Label, e.Source, e.BatchID, e.CreatedAt, e.UpdatedAt,
		e.CreatedByEmail, e.UpdatedByEmail})
	return string(b)
}

// groupEntries joins rows (ordered by applies_to, date) into ranges. The next
// day continues a range, and so does the day after a Sunday that has no entry.
func groupEntries(rows []db.ListCalendarEntriesRow) []entryRange {
	out := []entryRange{}
	for _, e := range rows {
		d := e.Date.Time
		key := rangeKey(e)
		if n := len(out); n > 0 {
			cur := &out[n-1]
			gap := int(d.Sub(cur.last).Hours() / 24)
			nextAfterSunday := gap == 2 && cur.last.AddDate(0, 0, 1).Weekday() == time.Sunday
			if cur.key == key && (gap == 1 || nextAfterSunday) {
				cur.End, cur.last = stats.DateKey(d), d
				cur.Days++
				cur.Dates = append(cur.Dates, stats.DateKey(d))
				cur.rows = append(cur.rows, e)
				continue
			}
		}
		r := entryRange{
			Start: stats.DateKey(d), End: stats.DateKey(d), Days: 1, AppliesTo: e.AppliesTo, DayType: e.DayType, Counts: e.Counts,
			Label: e.Label, Source: e.Source, CreatedAt: optTime(e.CreatedAt), UpdatedAt: optTime(e.UpdatedAt),
			CreatedBy: optAdmin(e.CreatedByName, e.CreatedByEmail), UpdatedBy: optAdmin(e.UpdatedByName, e.UpdatedByEmail),
			last: d, key: key, Dates: []string{stats.DateKey(d)}, rows: []db.ListCalendarEntriesRow{e},
		}
		if e.BatchID.Valid {
			r.Batch = &batchRef{ID: e.BatchID.Int64, FileName: e.BatchFileName.String, Kind: e.BatchKind.String}
		}
		out = append(out, r)
	}
	for i := range out {
		out[i].Token = entriesToken(out[i].rows)
	}
	return out
}

// GET /api/admin/calendar/entries: every saved calendar entry with its
// source, grouped into date ranges.
func (s *Server) handleListCalendarEntries(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListCalendarEntries(r.Context())
	if err != nil {
		s.internalError(w, "list calendar entries", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"entries": groupEntries(rows)})
}

type importBatchJSON struct {
	ID             int64        `json:"id"`
	Kind           string       `json:"kind"`
	FileName       string       `json:"file_name"`
	Status         string       `json:"status"`
	UploadedAt     time.Time    `json:"uploaded_at"`
	UploadedBy     *adminRef    `json:"uploaded_by"`
	Summary        batchSummary `json:"summary"`
	CurrentEntries int64        `json:"current_entries"`
}

// GET /api/admin/imports/history: saved uploads that wrote calendar entries,
// newest first. Uploads from before this history existed are not listed.
func (s *Server) handleImportHistory(w http.ResponseWriter, r *http.Request) {
	rows, err := s.store.ListImportBatches(r.Context())
	if err != nil {
		s.internalError(w, "list import batches", err)
		return
	}
	out := make([]importBatchJSON, len(rows))
	for i, b := range rows {
		var sum batchSummary
		_ = json.Unmarshal(b.Summary, &sum)
		if sum.Degrees == nil {
			sum.Degrees = []string{}
		}
		out[i] = importBatchJSON{
			ID: b.ID, Kind: b.Kind, FileName: b.FileName, Status: b.Status, UploadedAt: b.CreatedAt.Time.UTC(),
			UploadedBy: optAdmin(b.UploadedByName, b.UploadedByEmail), Summary: sum, CurrentEntries: b.CurrentEntries,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"batches": out})
}
