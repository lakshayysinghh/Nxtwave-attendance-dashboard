package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/importer"
	"attendance-dashboard/api/internal/stats"
)

type attendanceImportRow struct {
	Row       int      `json:"row"`
	NiatID    string   `json:"niat_id"`
	Name      string   `json:"name"`
	Status    string   `json:"status"`  // update, unchanged, error
	Changes   int      `json:"changes"` // days whose mark will be written
	Unchanged int      `json:"unchanged"`
	Blank     int      `json:"blank"`
	Skipped   []string `json:"skipped"` // cells that will not be saved, with the reason
	Errors    []string `json:"errors"`
	Warnings  []string `json:"warnings"`
}

type attendanceImportSummary struct {
	Rows             int `json:"rows"`
	StudentsAffected int `json:"students_affected"`
	RecordsToUpdate  int `json:"records_to_update"`
	UnchangedRecords int `json:"unchanged_records"`
	BlankCells       int `json:"blank_cells"`
	SkippedCells     int `json:"skipped_cells"`
	ErrorRows        int `json:"error_rows"`
}

// badColumnJSON is an unreadable date header. Suggested is the last counted
// day before the next readable column ("" when there is none); the column is
// read only after the admin sends a date for it in column_dates.
type badColumnJSON struct {
	importer.BadColumn
	Suggested string `json:"suggested"`
}

type attendanceImportResponse struct {
	FileName       string          `json:"file_name"`
	Dates          []string        `json:"dates"` // date columns that will be read, YYYY-MM-DD
	BadColumns     []badColumnJSON `json:"bad_columns"`
	HeaderErrors   []string        `json:"header_errors"`
	HeaderWarnings []string        `json:"header_warnings"`
	// MissingDates are suggestions for calendar entries, never applied automatically.
	MissingDates []missingDate           `json:"missing_dates"`
	Summary      attendanceImportSummary `json:"summary"`
	Rows         []attendanceImportRow   `json:"rows"`
	Committed    bool                    `json:"committed"`
	Saved        int                     `json:"saved"`
}

// POST /api/admin/imports/attendance (multipart field "file", optional
// field "column_dates": JSON {"<column>": "YYYY-MM-DD"} for unreadable date
// headers). Without commit=true it only previews. With commit=true it writes
// every changed mark in one transaction. A Present/Absent cell sets that
// day's mark; a blank cell changes nothing; any other value
// is skipped for that cell only. Errors (unknown NIAT IDs, repeated dates,
// undated columns) block the save unless skip_errors=true, which leaves out
// those rows and columns.
func (s *Server) handleImportAttendance(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, importer.MaxFileSize+1<<20)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "Choose a .xlsx or .csv file (max 10 MB) to upload.", nil)
		return
	}
	defer file.Close()
	commit := r.URL.Query().Get("commit") == "true"
	skipErrors := r.URL.Query().Get("skip_errors") == "true"

	columnDates, err := parseColumnDates(r.FormValue("column_dates"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	table, err := importer.ReadTable(file, header.Filename)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_file", err.Error(), nil)
		return
	}
	sheet, err := importer.ParseAttendance(table, stats.TodayIST(s.now()), columnDates)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_file", err.Error(), nil)
		return
	}

	resp, changes, err := s.previewAttendance(r, header.Filename, sheet, nil)
	if err != nil {
		s.internalError(w, "preview attendance import", err)
		return
	}
	if !commit {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	if resp.hasErrors() && !skipErrors {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed",
			"The file has errors. Fix them, or choose to skip the rows and columns with errors.", resp)
		return
	}
	err = pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		return saveImportedMarks(r, db.New(tx), changes, &resp)
	})
	if err != nil {
		s.internalError(w, "save attendance import", err)
		return
	}
	resp.Committed = true
	s.log.Info("attendance import committed", "admin_id", adminFrom(r.Context()).ID, "records", resp.Saved, "file", header.Filename)
	writeJSON(w, http.StatusOK, resp)
}

func (a attendanceImportResponse) hasErrors() bool {
	return a.Summary.ErrorRows > 0 || len(a.HeaderErrors) > 0 || len(a.BadColumns) > 0
}

func saveImportedMarks(r *http.Request, q *db.Queries, changes db.UpsertMarksParams, resp *attendanceImportResponse) error {
	if len(changes.NiatIds) == 0 {
		return nil
	}
	changes.UpdatedBy = adminFrom(r.Context()).ID
	n, err := q.UpsertMarks(r.Context(), changes)
	resp.Saved = int(n)
	return err
}

// parseColumnDates reads the column_dates form field: {"<column>": "YYYY-MM-DD"}.
func parseColumnDates(raw string) (map[int]time.Time, error) {
	if raw == "" {
		return nil, nil
	}
	var in map[string]string
	if err := json.Unmarshal([]byte(raw), &in); err != nil {
		return nil, errors.New(`column_dates must be JSON like {"7": "2026-08-19"}`)
	}
	out := make(map[int]time.Time, len(in))
	for k, v := range in {
		col, err := strconv.Atoi(k)
		if err != nil || col < 0 {
			return nil, fmt.Errorf("column_dates: %q is not a column number", k)
		}
		d, err := parseDate(v)
		if err != nil {
			return nil, fmt.Errorf("column_dates: %w", err)
		}
		out[col] = d
	}
	return out, nil
}

// previewAttendance checks every row against stored students, the calendar
// and existing marks, and collects the marks that would change.
// Error rows contribute no changes. pending holds students from the same
// upload that are not saved yet (the combined Students import); they take
// precedence over stored rows. It may be nil.
func (s *Server) previewAttendance(r *http.Request, fileName string, sheet importer.AttendanceSheet, pending map[string]db.Student) (attendanceImportResponse, db.UpsertMarksParams, error) {
	var changes db.UpsertMarksParams
	resp := attendanceImportResponse{
		FileName: fileName, Dates: []string{}, BadColumns: []badColumnJSON{},
		HeaderErrors: append([]string{}, sheet.HeaderErrors...), HeaderWarnings: append([]string{}, sheet.HeaderWarnings...),
		Rows: []attendanceImportRow{},
	}

	rl, err := s.loadRules(r.Context(), calendarStart, calendarEnd)
	if err != nil {
		return resp, changes, err
	}
	var from, to time.Time
	for _, dc := range sheet.Dates {
		resp.Dates = append(resp.Dates, stats.DateKey(dc.Date))
		if from.IsZero() || dc.Date.Before(from) {
			from = dc.Date
		}
		if dc.Date.After(to) {
			to = dc.Date
		}
	}
	slices.Sort(resp.Dates)
	if resp.MissingDates, err = s.missingDates(r.Context(), resp.Dates); err != nil {
		return resp, changes, err
	}

	var ids []string
	for _, row := range sheet.Rows {
		if row.NiatID != "" {
			ids = append(ids, row.NiatID)
		}
	}
	students := map[string]db.Student{}
	if len(ids) > 0 {
		found, err := s.store.GetStudentsByIDs(r.Context(), ids)
		if err != nil {
			return resp, changes, err
		}
		for _, st := range found {
			students[st.NiatID] = st
		}
	}
	maps.Copy(students, pending)
	resp.BadColumns = suggestColumnDates(sheet, students, rl)
	marks := map[string]stats.Marks{}
	if len(ids) > 0 && !from.IsZero() {
		if marks, err = s.loadMarks(r.Context(), ids, from, to); err != nil {
			return resp, changes, err
		}
	}

	for _, row := range sheet.Rows {
		out := attendanceImportRow{
			Row: row.Row, NiatID: row.NiatID, Name: row.FileName, Blank: row.Blank,
			Skipped: append([]string{}, row.Skipped...), Errors: append([]string{}, row.Errors...), Warnings: []string{},
		}
		st, known := students[row.NiatID]
		if row.NiatID != "" && !known {
			out.Errors = append(out.Errors, fmt.Sprintf("NIAT ID %s was not found. Import the student first.", row.NiatID))
		}
		if known {
			if row.FileName != "" && !strings.EqualFold(strings.Join(strings.Fields(row.FileName), " "), st.FullName) {
				out.Warnings = append(out.Warnings, fmt.Sprintf("Name in file (%q) differs from the saved name (%q).", row.FileName, st.FullName))
			}
			out.Name = st.FullName
		}

		var rowChanges db.UpsertMarksParams
		if known {
			stu := statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn)
			for _, c := range row.Cells {
				key := stats.DateKey(c.Date)
				if st.Status != "active" {
					out.Skipped = append(out.Skipped, fmt.Sprintf("%s: student is dropped.", c.Date.Format("2 Jan")))
					continue
				}
				if day := stats.ResolveDay(c.Date, stu, rl.cal, rl.terms, rl.today); !day.Counted {
					out.Skipped = append(out.Skipped, notCountedReason(day))
					continue
				}
				if markString(marks[row.NiatID][key]) == c.Status {
					out.Unchanged++
					continue
				}
				rowChanges.NiatIds = append(rowChanges.NiatIds, row.NiatID)
				rowChanges.Dates = append(rowChanges.Dates, pgDate(c.Date))
				rowChanges.Statuses = append(rowChanges.Statuses, c.Status)
			}
		}

		switch {
		case len(out.Errors) > 0:
			out.Status = "error"
			resp.Summary.ErrorRows++
		case len(rowChanges.NiatIds) > 0:
			out.Status = "update"
			out.Changes = len(rowChanges.NiatIds)
			resp.Summary.StudentsAffected++
			changes.NiatIds = append(changes.NiatIds, rowChanges.NiatIds...)
			changes.Dates = append(changes.Dates, rowChanges.Dates...)
			changes.Statuses = append(changes.Statuses, rowChanges.Statuses...)
		default:
			out.Status = "unchanged"
		}
		resp.Summary.RecordsToUpdate += out.Changes
		resp.Summary.UnchangedRecords += out.Unchanged
		resp.Summary.BlankCells += out.Blank
		resp.Summary.SkippedCells += len(out.Skipped)
		resp.Rows = append(resp.Rows, out)
	}
	resp.Summary.Rows = len(sheet.Rows)
	return resp, changes, nil
}

// suggestColumnDates suggests a date for each unreadable header: the last
// day before the next readable column that counts for the sheet's students
// (by the first known student's degree). No suggestion when there is no later
// column or the day already has a column.
func suggestColumnDates(sheet importer.AttendanceSheet, students map[string]db.Student, rl rules) []badColumnJSON {
	out := make([]badColumnJSON, 0, len(sheet.BadColumns))
	if len(sheet.BadColumns) == 0 {
		return out
	}
	var stu stats.Student
	for _, row := range sheet.Rows {
		if st, ok := students[row.NiatID]; ok {
			stu = stats.Student{Degree: st.DegreeCode}
			break
		}
	}
	used := map[string]bool{}
	for _, dc := range sheet.Dates {
		used[stats.DateKey(dc.Date)] = true
	}
	for _, bc := range sheet.BadColumns {
		out = append(out, badColumnJSON{BadColumn: bc})
		next := -1
		for i, dc := range sheet.Dates {
			if dc.Index > bc.Index && (next < 0 || dc.Index < sheet.Dates[next].Index) {
				next = i
			}
		}
		if next < 0 {
			continue
		}
		if d, ok := stats.PreviousCountedDay(sheet.Dates[next].Date, stu, rl.cal, rl.terms, rl.today); ok && !used[stats.DateKey(d)] {
			out[len(out)-1].Suggested = stats.DateKey(d)
		}
	}
	return out
}

func markString(st stats.Status) string {
	if p := markJSON(st); p != nil {
		return *p
	}
	return ""
}
