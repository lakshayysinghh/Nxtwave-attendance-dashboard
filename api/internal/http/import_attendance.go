package http

import (
	"fmt"
	"net/http"
	"slices"
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
	Changes   int      `json:"changes"` // half-day records that will be written
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

type attendanceImportResponse struct {
	FileName     string   `json:"file_name"`
	Dates        []string `json:"dates"` // date columns that will be read, YYYY-MM-DD
	HeaderErrors []string `json:"header_errors"`
	// MissingDates are suggestions for calendar entries, never applied automatically.
	MissingDates []missingDate           `json:"missing_dates"`
	Summary      attendanceImportSummary `json:"summary"`
	Rows         []attendanceImportRow   `json:"rows"`
	Committed    bool                    `json:"committed"`
	Saved        int                     `json:"saved"`
}

// POST /api/admin/imports/attendance (multipart field "file").
// Without commit=true it only previews. With commit=true it writes every
// changed half-day record in one transaction. A Present/Absent cell sets both
// halves (FH and SH); a blank cell changes nothing. Errors block the save
// unless skip_errors=true, which leaves out error rows and bad columns.
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

	table, err := importer.ReadTable(file, header.Filename)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_file", err.Error(), nil)
		return
	}
	sheet, err := importer.ParseAttendance(table, stats.TodayIST(s.now()))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_file", err.Error(), nil)
		return
	}

	resp, changes, err := s.previewAttendance(r, header.Filename, sheet)
	if err != nil {
		s.internalError(w, "preview attendance import", err)
		return
	}
	if !commit {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	if (resp.Summary.ErrorRows > 0 || len(resp.HeaderErrors) > 0) && !skipErrors {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed",
			"The file has errors. Fix them, or choose to skip the rows and columns with errors.", resp)
		return
	}
	if len(changes.NiatIds) > 0 {
		changes.UpdatedBy = adminFrom(r.Context()).ID
		err = pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
			n, err := db.New(tx).UpsertMarks(r.Context(), changes)
			resp.Saved = int(n)
			return err
		})
		if err != nil {
			s.internalError(w, "save attendance import", err)
			return
		}
	}
	resp.Committed = true
	s.log.Info("attendance import committed", "admin_id", adminFrom(r.Context()).ID, "records", resp.Saved, "file", header.Filename)
	writeJSON(w, http.StatusOK, resp)
}

// previewAttendance checks every row against stored students, the calendar
// and existing marks, and collects the half-day records that would change.
// Error rows contribute no changes.
func (s *Server) previewAttendance(r *http.Request, fileName string, sheet importer.AttendanceSheet) (attendanceImportResponse, db.UpsertMarksParams, error) {
	var changes db.UpsertMarksParams
	resp := attendanceImportResponse{FileName: fileName, Dates: []string{}, HeaderErrors: sheet.HeaderErrors, Rows: []attendanceImportRow{}}
	if resp.HeaderErrors == nil {
		resp.HeaderErrors = []string{}
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
	marks := map[string]stats.Marks{}
	if len(ids) > 0 && !from.IsZero() {
		if marks, err = s.loadMarks(r.Context(), ids, from, to); err != nil {
			return resp, changes, err
		}
	}

	for _, row := range sheet.Rows {
		out := attendanceImportRow{
			Row: row.Row, NiatID: row.NiatID, Name: row.FileName, Blank: row.Blank,
			Skipped: []string{}, Errors: append([]string{}, row.Errors...), Warnings: []string{},
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
				saved := marks[row.NiatID][key]
				for half := int16(1); half <= 2; half++ {
					if markString(saved[half-1]) == c.Status {
						out.Unchanged++
						continue
					}
					rowChanges.NiatIds = append(rowChanges.NiatIds, row.NiatID)
					rowChanges.Dates = append(rowChanges.Dates, pgDate(c.Date))
					rowChanges.Halves = append(rowChanges.Halves, half)
					rowChanges.Statuses = append(rowChanges.Statuses, c.Status)
				}
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
			changes.Halves = append(changes.Halves, rowChanges.Halves...)
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

func markString(st stats.Status) string {
	if p := markJSON(st); p != nil {
		return *p
	}
	return ""
}
