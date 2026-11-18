package http

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/xuri/excelize/v2"

	"attendance-dashboard/api/internal/stats"
)

// maxExportDays bounds one attendance export: enough to catch up on a couple
// of months after an outage, small enough to stay quick.
const maxExportDays = 62

// exportHeaderLayout matches the team's master sheet ("13-Nov-2026"), which
// the attendance import also reads back.
const exportHeaderLayout = "2-Jan-2006"

type exportRow struct {
	NiatID  string   `json:"niat_id"`
	Name    string   `json:"name"`
	Section string   `json:"section"`
	Dropped bool     `json:"dropped"`
	Values  []string `json:"values"` // one per date, "" when nothing is saved
}

type exportDegree struct {
	Degree string      `json:"degree"`
	Rows   []exportRow `json:"rows"`
	// Unmarked counts class days of active students with no mark yet, so a
	// half-finished day is not taken as a complete backup.
	Unmarked int `json:"unmarked"`
	// Unordered counts students with no position from a student import; they
	// are listed last and may not line up with the sheet.
	Unordered int `json:"unordered"`
}

type exportResponse struct {
	From    string         `json:"from"`
	To      string         `json:"to"`
	Today   string         `json:"today"`
	Dates   []string       `json:"dates"`   // YYYY-MM-DD
	Headers []string       `json:"headers"` // as in the sheet: 13-Nov-2026
	Degrees []exportDegree `json:"degrees"`
}

// GET /api/admin/exports/attendance?from=YYYY-MM-DD&to=YYYY-MM-DD
// The saved attendance for each date, one block of students per degree in
// the order of the student import file, for pasting into the master sheet.
func (s *Server) handleExportAttendance(w http.ResponseWriter, r *http.Request) {
	out, ok := s.attendanceExport(w, r)
	if ok {
		writeJSON(w, http.StatusOK, out)
	}
}

// GET /api/admin/exports/attendance.xlsx: the same, one tab per degree.
func (s *Server) handleExportAttendanceXLSX(w http.ResponseWriter, r *http.Request) {
	out, ok := s.attendanceExport(w, r)
	if !ok {
		return
	}
	buf, err := exportWorkbook(out)
	if err != nil {
		s.internalError(w, "build export workbook", err)
		return
	}
	name := "attendance-" + out.From
	if out.To != out.From {
		name += "-to-" + out.To
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.xlsx"`, name))
	_, _ = w.Write(buf)
}

func (s *Server) attendanceExport(w http.ResponseWriter, r *http.Request) (exportResponse, bool) {
	var out exportResponse
	rl, err := s.loadRules(r.Context(), calendarStart, calendarEnd)
	if err != nil {
		s.internalError(w, "load rules", err)
		return out, false
	}
	from, to := rl.today, rl.today
	if v := r.URL.Query().Get("from"); v != "" {
		if from, err = parseDate(v); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "from: "+err.Error(), nil)
			return out, false
		}
		to = from
	}
	if v := r.URL.Query().Get("to"); v != "" {
		if to, err = parseDate(v); err != nil {
			writeError(w, http.StatusBadRequest, "bad_request", "to: "+err.Error(), nil)
			return out, false
		}
	}
	switch {
	case to.Before(from):
		writeError(w, http.StatusBadRequest, "bad_request", "The To date is before the From date.", nil)
		return out, false
	case to.Sub(from) >= maxExportDays*24*time.Hour:
		writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("Export at most %d days at a time.", maxExportDays), nil)
		return out, false
	}
	out, err = s.buildAttendanceExport(r.Context(), rl, from, to)
	if err != nil {
		s.internalError(w, "attendance export", err)
		return out, false
	}
	return out, true
}

func (s *Server) buildAttendanceExport(ctx context.Context, rl rules, from, to time.Time) (exportResponse, error) {
	out := exportResponse{From: stats.DateKey(from), To: stats.DateKey(to), Today: stats.DateKey(rl.today), Dates: []string{}, Headers: []string{}, Degrees: []exportDegree{}}
	var dates []time.Time
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		dates = append(dates, d)
		out.Dates = append(out.Dates, stats.DateKey(d))
		out.Headers = append(out.Headers, d.Format(exportHeaderLayout))
	}

	degrees, err := s.store.ListDegrees(ctx)
	if err != nil {
		return out, fmt.Errorf("list degrees: %w", err)
	}
	students, err := s.store.ListStudentsForExport(ctx)
	if err != nil {
		return out, fmt.Errorf("list students: %w", err)
	}
	ids := make([]string, len(students))
	for i, st := range students {
		ids[i] = st.NiatID
	}
	marks, cats, err := s.loadMarksWithCategories(ctx, s.store, ids, from, to)
	if err != nil {
		return out, err
	}

	byDegree := map[string]*exportDegree{}
	for _, d := range degrees {
		out.Degrees = append(out.Degrees, exportDegree{Degree: d.Code, Rows: []exportRow{}})
	}
	for i := range out.Degrees {
		byDegree[out.Degrees[i].Degree] = &out.Degrees[i]
	}
	for _, st := range students {
		deg := byDegree[st.DegreeCode]
		if deg == nil { // a degree code the degrees table no longer has
			out.Degrees = append(out.Degrees, exportDegree{Degree: st.DegreeCode, Rows: []exportRow{}})
			for i := range out.Degrees {
				byDegree[out.Degrees[i].Degree] = &out.Degrees[i]
			}
			deg = byDegree[st.DegreeCode]
		}
		student := statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn)
		row := exportRow{NiatID: st.NiatID, Name: st.FullName, Section: st.Section, Dropped: st.Status == "dropped", Values: make([]string, len(dates))}
		for j, d := range dates {
			key := stats.DateKey(d)
			day := stats.ResolveDay(d, student, rl.cal, rl.terms, rl.today)
			mark := marks[st.NiatID][key]
			row.Values[j] = exportCell(day, mark, cats.of(st.NiatID, key))
			if mark == stats.NotMarked && day.Counted && st.Status == "active" {
				deg.Unmarked++
			}
		}
		if !st.SheetOrder.Valid {
			deg.Unordered++
		}
		deg.Rows = append(deg.Rows, row)
	}
	return out, nil
}

// exportCell is the cell text for one student and day, in the words the
// master sheet (and the attendance import) use. A saved mark always wins;
// without one, holidays, exams and Sundays get their name and anything else
// stays blank.
func exportCell(day stats.Day, mark stats.Status, cat stats.Category) string {
	switch mark {
	case stats.Present, stats.Absent:
		switch cat {
		case stats.CategoryInternship:
			return "Internship Period"
		case stats.CategoryRegistrationPending:
			return "Term 5 Registration Pending"
		}
		if mark == stats.Present {
			return "Present"
		}
		return "Absent"
	}
	if day.Excluded == stats.Future {
		return ""
	}
	named := func(fallback string) string {
		if day.Label != "" {
			return day.Label
		}
		return fallback
	}
	switch day.Kind {
	case stats.KindHoliday:
		return named("Holiday")
	case stats.KindExam:
		return named("Exam")
	case stats.KindExamPrep:
		return named("Exam Preparation")
	case stats.KindSunday:
		return "Sunday"
	}
	return ""
}

func exportWorkbook(out exportResponse) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	bold, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	first := true
	for _, deg := range out.Degrees {
		if len(deg.Rows) == 0 {
			continue
		}
		if first {
			if err := f.SetSheetName("Sheet1", deg.Degree); err != nil {
				return nil, err
			}
			first = false
		} else if _, err := f.NewSheet(deg.Degree); err != nil {
			return nil, err
		}
		header := []any{"NIAT ID", "Student Full Name", "Section"}
		for _, h := range out.Headers {
			header = append(header, h)
		}
		if err := f.SetSheetRow(deg.Degree, "A1", &header); err != nil {
			return nil, err
		}
		last, _ := excelize.CoordinatesToCellName(len(header), 1)
		_ = f.SetCellStyle(deg.Degree, "A1", last, bold)
		for i, row := range deg.Rows {
			line := []any{row.NiatID, row.Name, row.Section}
			for _, v := range row.Values {
				line = append(line, v)
			}
			cell, _ := excelize.CoordinatesToCellName(1, i+2)
			if err := f.SetSheetRow(deg.Degree, cell, &line); err != nil {
				return nil, err
			}
		}
		_ = f.SetColWidth(deg.Degree, "A", "A", 16)
		_ = f.SetColWidth(deg.Degree, "B", "B", 32)
		_ = f.SetColWidth(deg.Degree, "C", "C", 10)
		if len(header) > 3 {
			lastCol, _ := excelize.ColumnNumberToName(len(header))
			_ = f.SetColWidth(deg.Degree, "D", lastCol, 14)
		}
		_ = f.SetPanes(deg.Degree, &excelize.Panes{Freeze: true, XSplit: 3, YSplit: 1, TopLeftCell: "D2", ActivePane: "bottomRight"})
	}
	if first { // no students at all: still a valid, empty workbook
		_ = f.SetSheetRow("Sheet1", "A1", &[]any{"NIAT ID", "Student Full Name", "Section"})
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
