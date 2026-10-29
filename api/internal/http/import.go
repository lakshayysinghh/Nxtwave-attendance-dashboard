package http

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/importer"
	"attendance-dashboard/api/internal/stats"
)

type importRow struct {
	importer.StudentRow
	Action string `json:"action"` // new, update, unchanged, error
}

type importSummary struct {
	Total     int `json:"total"`
	New       int `json:"new"`
	Updated   int `json:"updated"`
	Unchanged int `json:"unchanged"`
	Errors    int `json:"errors"`
	Warnings  int `json:"warnings"`
}

type importResponse struct {
	FileName  string        `json:"file_name"`
	Summary   importSummary `json:"summary"`
	Rows      []importRow   `json:"rows"`
	Committed bool          `json:"committed"`
	Saved     int           `json:"saved"`
	// Attendance is the preview of the sheet's date columns, when it has any.
	// The same commit saves them, after the students.
	Attendance *attendanceImportResponse `json:"attendance,omitempty"`
}

// POST /api/admin/imports/students (multipart field "file", optional
// "column_dates" as for the attendance import).
// Without commit=true it only previews. With commit=true it saves new and
// changed rows in one transaction; rows with errors block the save unless
// skip_errors=true, in which case they are left out. When the sheet also has
// date columns, their marks are previewed and saved in the same transaction.
func (s *Server) handleImportStudents(w http.ResponseWriter, r *http.Request) {
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
	pattern, degrees, err := s.importRules(r)
	if err != nil {
		s.internalError(w, "import rules", err)
		return
	}
	parsed, err := importer.ParseStudents(table, pattern, degrees)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_file", err.Error(), nil)
		return
	}

	resp, pocIDs, existing, err := s.previewStudents(r, header.Filename, parsed)
	if err != nil {
		s.internalError(w, "preview import", err)
		return
	}

	// The same sheet's date columns, if any. Without date columns there is
	// no attendance part, and the parse error is not shown.
	var marks db.UpsertMarksParams
	columnDates, err := parseColumnDates(r.FormValue("column_dates"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", err.Error(), nil)
		return
	}
	if sheet, err := importer.ParseAttendance(table, stats.TodayIST(s.now()), columnDates); err == nil {
		att, changes, err := s.previewAttendance(r, header.Filename, sheet, pendingStudents(resp.Rows, existing))
		if err != nil {
			s.internalError(w, "preview attendance in student import", err)
			return
		}
		resp.Attendance, marks = &att, changes
	}

	if !commit {
		writeJSON(w, http.StatusOK, resp)
		return
	}
	if (resp.Summary.Errors > 0 || (resp.Attendance != nil && resp.Attendance.hasErrors())) && !skipErrors {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed",
			"The file has errors. Fix them, or choose to skip the rows and columns with errors.", resp)
		return
	}

	err = pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		for _, row := range resp.Rows {
			if row.Action != "new" && row.Action != "update" {
				continue
			}
			var poc pgtype.Int8
			if row.POC != "" {
				id, ok := pocIDs[strings.ToLower(row.POC)]
				if !ok {
					if err := q.InsertMentorIfMissing(r.Context(), db.InsertMentorIfMissingParams{Name: row.POC, Kind: "poc"}); err != nil {
						return err
					}
					m, err := q.GetMentorByName(r.Context(), db.GetMentorByNameParams{Kind: "poc", Name: row.POC})
					if err != nil {
						return err
					}
					id = m.ID
					pocIDs[strings.ToLower(row.POC)] = id
				}
				poc = pgtype.Int8{Int64: id, Valid: true}
			}
			p := db.UpsertStudentFromImportParams{
				NiatID: row.NiatID, FullName: row.Name, DegreeCode: row.Degree, Section: row.Section,
				Level: optionalText(row.Level), HallNo: optionalText(row.HallNo), PocID: poc,
			}
			if row.JoinedOn != nil {
				p.JoinedOn = pgDate(*row.JoinedOn)
			}
			if err := q.UpsertStudentFromImport(r.Context(), p); err != nil {
				return fmt.Errorf("row %d: %w", row.Row, err)
			}
			resp.Saved++
		}
		if resp.Attendance == nil {
			return nil
		}
		// Students first, so marks for new NIAT IDs have their student row.
		return saveImportedMarks(r, q, marks, resp.Attendance)
	})
	if err != nil {
		s.internalError(w, "save import", err)
		return
	}
	resp.Committed = true
	marksSaved := 0
	if resp.Attendance != nil {
		resp.Attendance.Committed = true
		marksSaved = resp.Attendance.Saved
	}
	s.log.Info("student import committed", "admin_id", adminFrom(r.Context()).ID, "saved", resp.Saved, "marks", marksSaved, "file", header.Filename)
	writeJSON(w, http.StatusOK, resp)
}

// pendingStudents are the valid rows of a student upload as they will be
// after the commit, so the same file's attendance can be checked against them.
func pendingStudents(rows []importRow, existing map[string]db.Student) map[string]db.Student {
	out := map[string]db.Student{}
	for _, row := range rows {
		if row.Action == "error" {
			continue
		}
		st, found := existing[row.NiatID]
		if !found {
			st = db.Student{NiatID: row.NiatID, Status: "active"}
		}
		st.FullName, st.DegreeCode, st.Section = row.Name, row.Degree, row.Section
		if row.JoinedOn != nil {
			st.JoinedOn = pgDate(*row.JoinedOn)
		}
		out[row.NiatID] = st
	}
	return out
}

// importRules loads the NIAT ID pattern from settings (falling back to the
// default) and the known degree codes.
func (s *Server) importRules(r *http.Request) (*regexp.Regexp, map[string]bool, error) {
	pattern := niatIDPattern
	if setting, err := s.store.GetSetting(r.Context(), "niat_id_pattern"); err == nil {
		var p string
		if json.Unmarshal(setting.Value, &p) == nil && p != "" {
			if re, err := regexp.Compile(p); err == nil {
				pattern = re
			}
		}
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, nil, err
	}
	list, err := s.store.ListDegrees(r.Context())
	if err != nil {
		return nil, nil, err
	}
	degrees := map[string]bool{}
	for _, d := range list {
		degrees[d.Code] = true
	}
	return pattern, degrees, nil
}

// previewStudents compares valid rows with stored students and POCs. It
// returns the known POC ids by lowercased name for the commit step, and the
// stored students found by NIAT ID.
func (s *Server) previewStudents(r *http.Request, fileName string, parsed []importer.StudentRow) (importResponse, map[string]int64, map[string]db.Student, error) {
	resp := importResponse{FileName: fileName, Rows: make([]importRow, len(parsed))}
	var ids []string
	for _, p := range parsed {
		if len(p.Errors) == 0 {
			ids = append(ids, p.NiatID)
		}
	}
	existing := map[string]db.Student{}
	if len(ids) > 0 {
		found, err := s.store.GetStudentsByIDs(r.Context(), ids)
		if err != nil {
			return resp, nil, nil, err
		}
		for _, st := range found {
			existing[st.NiatID] = st
		}
	}

	pocIDs := map[string]int64{}
	newPOCs := map[string]bool{}
	for _, p := range parsed {
		key := strings.ToLower(p.POC)
		if p.POC == "" || len(p.Errors) > 0 || newPOCs[key] {
			continue
		}
		if _, ok := pocIDs[key]; ok {
			continue
		}
		m, err := s.store.GetMentorByName(r.Context(), db.GetMentorByNameParams{Kind: "poc", Name: p.POC})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			newPOCs[key] = true
		case err != nil:
			return resp, nil, nil, err
		default:
			pocIDs[key] = m.ID
		}
	}

	for i, p := range parsed {
		row := importRow{StudentRow: p}
		if row.Errors == nil {
			row.Errors = []string{}
		}
		if newPOCs[strings.ToLower(p.POC)] {
			row.Warnings = append(row.Warnings, fmt.Sprintf("New POC %q will be created (check the spelling).", p.POC))
		}
		if row.Warnings == nil {
			row.Warnings = []string{}
		}
		switch st, found := existing[p.NiatID]; {
		case len(p.Errors) > 0:
			row.Action = "error"
			resp.Summary.Errors++
		case !found:
			row.Action = "new"
			resp.Summary.New++
		case studentChanged(st, p, pocIDs):
			row.Action = "update"
			resp.Summary.Updated++
		default:
			row.Action = "unchanged"
			resp.Summary.Unchanged++
		}
		if len(row.Warnings) > 0 {
			resp.Summary.Warnings++
		}
		resp.Rows[i] = row
	}
	resp.Summary.Total = len(parsed)
	return resp, pocIDs, existing, nil
}

// studentChanged reports whether saving the row would change the stored
// student. Blank optional cells keep stored values, so they never count.
func studentChanged(st db.Student, p importer.StudentRow, pocIDs map[string]int64) bool {
	if st.FullName != p.Name || st.DegreeCode != p.Degree || st.Section != p.Section {
		return true
	}
	if p.Level != "" && optText(st.Level) != p.Level {
		return true
	}
	if p.HallNo != "" && optText(st.HallNo) != p.HallNo {
		return true
	}
	if p.POC != "" {
		id, known := pocIDs[strings.ToLower(p.POC)]
		if !known || !st.PocID.Valid || st.PocID.Int64 != id {
			return true
		}
	}
	if p.JoinedOn != nil && (!st.JoinedOn.Valid || stats.DateKey(st.JoinedOn.Time) != stats.DateKey(*p.JoinedOn)) {
		return true
	}
	return false
}

func optionalText(s string) pgtype.Text {
	return pgtype.Text{String: s, Valid: s != ""}
}
