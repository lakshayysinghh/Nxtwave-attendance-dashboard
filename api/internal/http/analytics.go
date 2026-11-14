package http

import (
	"context"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/stats"
)

// analyticsFilter is the page's Degree / Hall / Section choice. Hall is nil
// for all halls and "" for students with no hall.
type analyticsFilter struct {
	Degree  string  `json:"degree"`
	Hall    *string `json:"hall"`
	Section string  `json:"section"`
}

type analyticsPeriod struct {
	From  string      `json:"from"`
	To    string      `json:"to"`
	Total stats.Tally `json:"total"`
}

type analyticsOptions struct {
	Degrees  []string     `json:"degrees"`
	Halls    []degreeItem `json:"halls"`
	Sections []degreeItem `json:"sections"`
}

type degreeItem struct {
	Degree string `json:"degree"`
	Value  string `json:"value"`
}

type analyticsResponse struct {
	Period      string           `json:"period"` // today, last7, lastmonth or custom
	From        string           `json:"from"`
	To          string           `json:"to"`
	Today       string           `json:"today"`
	Days        int              `json:"days"` // calendar days in the period
	GeneratedAt string           `json:"generated_at"`
	Filter      analyticsFilter  `json:"filter"`
	Options     analyticsOptions `json:"options"`
	stats.Analytics
	Insights stats.Insights  `json:"insights"`
	Previous analyticsPeriod `json:"previous"`
}

// analytics reads ?period=today|last7|lastmonth (dates in IST) or ?from=&to=
// (default: today), plus degree, hall and section,
// and builds the aggregated report. No student is named in it.
func (s *Server) analytics(w http.ResponseWriter, r *http.Request) (analyticsResponse, bool) {
	in, ok := s.loadAnalytics(w, r)
	if !ok {
		return analyticsResponse{}, false
	}
	rl, students, from, to := in.rl, in.students, in.from, in.to
	a := stats.Analyze(students, from, to, rl.cal, rl.terms, rl.today)
	pFrom, pTo := stats.ComparePeriod(in.period, from, to)
	if from.Equal(to) {
		if d, found := stats.PreviousWorkingDay(students, from, rl.cal, rl.terms, rl.today); found {
			pFrom, pTo = d, d
		}
	}
	prev := stats.Analyze(students, pFrom, pTo, rl.cal, rl.terms, rl.today).Total
	return analyticsResponse{
		Period: in.period, From: stats.DateKey(from), To: stats.DateKey(to), Today: stats.DateKey(rl.today),
		Days:        int(to.Sub(from).Hours()/24) + 1,
		GeneratedAt: s.now().In(stats.IST).Format(time.RFC3339),
		Filter:      in.filter, Options: in.options, Analytics: a,
		Insights: stats.BuildInsights(a, prev),
		Previous: analyticsPeriod{From: stats.DateKey(pFrom), To: stats.DateKey(pTo), Total: prev},
	}, true
}

// analyticsInput is everything the report and the drill-down lists share:
// the period, the filter, and every student with their marks (unselected
// students still decide working days).
type analyticsInput struct {
	rl       rules
	period   string
	from, to time.Time
	filter   analyticsFilter
	options  analyticsOptions
	rows     []db.ListStudentsForAdminRow
	students []stats.AnalyticsStudent
}

func (s *Server) loadAnalytics(w http.ResponseWriter, r *http.Request) (analyticsInput, bool) {
	var out analyticsInput
	rl, err := s.loadRules(r.Context(), calendarStart, calendarEnd)
	if err != nil {
		s.internalError(w, "load rules", err)
		return out, false
	}
	v := r.URL.Query()
	period := v.Get("period")
	var from, to time.Time
	switch period {
	case "", "custom":
		f, t, set, ok := rangeParam(w, r)
		if !ok {
			return out, false
		}
		if from, to, period = f, t, "custom"; !set {
			from, to, period = rl.today, rl.today, "today"
		}
	default:
		var ok bool
		if from, to, ok = stats.PresetRange(period, rl.today); !ok {
			writeError(w, http.StatusBadRequest, "bad_range", `period must be "today", "last7", "lastmonth" or "custom".`, nil)
			return out, false
		}
	}
	f := analyticsFilter{Degree: strings.ToUpper(strings.TrimSpace(v.Get("degree"))), Section: strings.ToUpper(strings.TrimSpace(v.Get("section")))}
	if v.Has("hall") {
		h := strings.TrimSpace(v.Get("hall"))
		f.Hall = &h
	}

	rows, err := s.store.ListStudentsForAdmin(r.Context(), db.ListStudentsForAdminParams{})
	if err != nil {
		s.internalError(w, "list students", err)
		return out, false
	}
	pFrom, _ := stats.ComparePeriod(period, from, to)
	ids := make([]string, len(rows))
	for i, st := range rows {
		ids[i] = st.NiatID
	}
	loadFrom := pFrom
	if from.Equal(to) { // one day: compared with the previous working day, up to MaxLookBack days back
		loadFrom = from.AddDate(0, 0, -stats.MaxLookBack)
	}
	marks, err := s.loadMarks(r.Context(), ids, loadFrom, to)
	if err != nil {
		s.internalError(w, "load marks", err)
		return out, false
	}

	students := make([]stats.AnalyticsStudent, len(rows))
	opts := analyticsOptions{Degrees: []string{}, Halls: []degreeItem{}, Sections: []degreeItem{}}
	seen := map[string]bool{}
	for i, st := range rows {
		hall := optText(st.HallNo)
		students[i] = stats.AnalyticsStudent{
			Student:  statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn),
			Hall:     hall,
			Marks:    marks[st.NiatID],
			Selected: (f.Degree == "" || st.DegreeCode == f.Degree) && (f.Hall == nil || hall == *f.Hall) && (f.Section == "" || st.Section == f.Section),
		}
		for _, k := range []string{"d\x00" + st.DegreeCode, "h\x00" + st.DegreeCode + "\x00" + hall, "s\x00" + st.DegreeCode + "\x00" + st.Section} {
			if seen[k] {
				continue
			}
			seen[k] = true
			switch k[0] {
			case 'd':
				opts.Degrees = append(opts.Degrees, st.DegreeCode)
			case 'h':
				opts.Halls = append(opts.Halls, degreeItem{st.DegreeCode, hall})
			default:
				opts.Sections = append(opts.Sections, degreeItem{st.DegreeCode, st.Section})
			}
		}
	}
	sort.Strings(opts.Degrees)
	sort.Slice(opts.Halls, func(i, j int) bool { return stats.HallLess(opts.Halls[i].Value, opts.Halls[j].Value) })
	sort.Slice(opts.Sections, func(i, j int) bool { return opts.Sections[i].Value < opts.Sections[j].Value })

	return analyticsInput{rl: rl, period: period, from: from, to: to, filter: f, options: opts, rows: rows, students: students}, true
}

type analyticsStudentRow struct {
	NiatID  string `json:"niat_id"`
	Name    string `json:"name"`
	Degree  string `json:"degree"`
	Section string `json:"section"`
	HallNo  string `json:"hall_no"`
	stats.StudentTally
}

// GET /api/admin/analytics/students?<same as the report>&show=all|present|absent|unmarked
// (Owner only): the students behind a card or a degree / hall row, with
// their present, absent and unmarked working days in the period.
func (s *Server) handleAnalyticsStudents(w http.ResponseWriter, r *http.Request) {
	show := r.URL.Query().Get("show")
	if show == "" {
		show = "all"
	}
	if !stats.ValidShow(show) {
		writeError(w, http.StatusBadRequest, "bad_request", `show must be "all", "present", "absent" or "unmarked".`, nil)
		return
	}
	in, ok := s.loadAnalytics(w, r)
	if !ok {
		return
	}
	out := []analyticsStudentRow{}
	for _, t := range stats.StudentTallies(in.students, in.from, in.to, in.rl.cal, in.rl.terms, in.rl.today, show) {
		st := in.rows[t.Index]
		out = append(out, analyticsStudentRow{
			NiatID: st.NiatID, Name: st.FullName, Degree: st.DegreeCode, Section: st.Section, HallNo: optText(st.HallNo), StudentTally: t,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"from": stats.DateKey(in.from), "to": stats.DateKey(in.to), "show": show, "students": out})
}

// GET /api/admin/analytics?from=&to=&degree=&hall=&section= (Owner only).
func (s *Server) handleAnalytics(w http.ResponseWriter, r *http.Request) {
	if out, ok := s.analytics(w, r); ok {
		writeJSON(w, http.StatusOK, out)
	}
}

// GET /api/admin/analytics/export.xlsx: the same report as a workbook
// (Owner only). Aggregates only; no student is listed.
func (s *Server) handleAnalyticsExport(w http.ResponseWriter, r *http.Request) {
	out, ok := s.analytics(w, r)
	if !ok {
		return
	}
	buf, err := analyticsWorkbook(r.Context(), out)
	if err != nil {
		s.internalError(w, "build workbook", err)
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="attendance-analytics-%s-to-%s.xlsx"`, out.From, out.To))
	_, _ = w.Write(buf)
}

func pctCell(p *float64) any {
	if p == nil {
		return "–"
	}
	return *p / 100 // formatted as a percentage
}

func numCell(p *float64) any {
	if p == nil {
		return "–"
	}
	return *p
}

func hallName(h string) string {
	if h == "" {
		return "No hall"
	}
	return h
}

func analyticsWorkbook(_ context.Context, a analyticsResponse) ([]byte, error) {
	f := excelize.NewFile()
	defer func() { _ = f.Close() }()
	bold, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true}})
	title, _ := f.NewStyle(&excelize.Style{Font: &excelize.Font{Bold: true, Size: 14}})
	pct, _ := f.NewStyle(&excelize.Style{NumFmt: 10}) // 0.00%

	scope := "All degrees"
	if a.Filter.Degree != "" {
		scope = a.Filter.Degree
	}
	if a.Filter.Hall != nil {
		scope += " · " + hallName(*a.Filter.Hall)
	}
	if a.Filter.Section != "" {
		scope += " · Section " + a.Filter.Section
	}
	generated, _ := time.Parse(time.RFC3339, a.GeneratedAt)

	type sheet struct {
		name   string
		header []string
		rows   [][]any
		pctCol int // 1-based column holding a %; 0 for none
	}
	tallyRow := func(lead []any, t stats.Tally) []any {
		return append(lead, t.Students, t.Present, t.Absent, t.Unmarked, t.WorkingDays, numCell(t.AvgPresent), pctCell(t.Pct))
	}
	cols := []string{"Eligible students", "Present (student-days)", "Absent (student-days)", "Unmarked (student-days)", "Working days", "Avg present per day", "Attendance %"}
	degrees := sheet{name: "By degree", header: append([]string{"Degree"}, cols...), pctCol: 8}
	for _, g := range a.Degrees {
		degrees.rows = append(degrees.rows, tallyRow([]any{g.Degree}, g.Tally))
	}
	degrees.rows = append(degrees.rows, tallyRow([]any{"Total"}, a.Total))
	halls := sheet{name: "By hall", header: append([]string{"Degree", "Hall"}, cols...), pctCol: 9}
	for _, g := range a.Halls {
		halls.rows = append(halls.rows, tallyRow([]any{g.Degree, hallName(g.Hall)}, g.Tally))
	}
	daily := sheet{name: "Daily", header: []string{"Date", "Eligible students", "Present", "Absent", "Unmarked", "Attendance %"}, pctCol: 6}
	for _, d := range a.Daily {
		daily.rows = append(daily.rows, []any{d.Date, d.Students, d.Present, d.Absent, d.Unmarked, pctCell(d.Pct)})
	}

	const sum = "Summary"
	if err := f.SetSheetName("Sheet1", sum); err != nil {
		return nil, err
	}
	lines := [][]any{
		{"Attendance analytics"},
		{"Period", a.From + " to " + a.To},
		{"Scope", scope},
		{"Generated (IST)", generated.Format("02 Jan 2006, 3:04 PM")},
		{},
		{"Eligible students", a.Total.Students},
		{"Present (student-days)", a.Total.Present},
		{"Absent (student-days)", a.Total.Absent},
		{"Unmarked (student-days)", a.Total.Unmarked},
		{"Students with unmarked days", a.Total.UnmarkedStudents},
		{"Working days", a.Total.WorkingDays},
		{"Average present per working day", numCell(a.Total.AvgPresent)},
		{"Attendance %", pctCell(a.Total.Pct)},
		{"Previous period", a.Previous.From + " to " + a.Previous.To},
		{"Previous attendance %", pctCell(a.Previous.Total.Pct)},
		{"Change (percentage points)", numCell(a.Insights.Change)},
		{},
		{"Attendance % = present ÷ (present + absent). Unmarked days are not counted as absent."},
	}
	for i, l := range lines {
		cell, _ := excelize.CoordinatesToCellName(1, i+1)
		if err := f.SetSheetRow(sum, cell, &l); err != nil {
			return nil, err
		}
	}
	_ = f.SetCellStyle(sum, "A1", "A1", title)
	_ = f.SetCellStyle(sum, "B13", "B13", pct)
	_ = f.SetCellStyle(sum, "B15", "B15", pct)
	_ = f.SetColWidth(sum, "A", "A", 34)
	_ = f.SetColWidth(sum, "B", "B", 28)

	for _, sh := range []sheet{degrees, halls, daily} {
		if _, err := f.NewSheet(sh.name); err != nil {
			return nil, err
		}
		header := make([]any, len(sh.header))
		for i, h := range sh.header {
			header[i] = h
		}
		if err := f.SetSheetRow(sh.name, "A1", &header); err != nil {
			return nil, err
		}
		last, _ := excelize.CoordinatesToCellName(len(sh.header), 1)
		_ = f.SetCellStyle(sh.name, "A1", last, bold)
		for i, row := range sh.rows {
			cell, _ := excelize.CoordinatesToCellName(1, i+2)
			if err := f.SetSheetRow(sh.name, cell, &row); err != nil {
				return nil, err
			}
		}
		if len(sh.rows) > 0 {
			top, _ := excelize.CoordinatesToCellName(sh.pctCol, 2)
			bottom, _ := excelize.CoordinatesToCellName(sh.pctCol, len(sh.rows)+1)
			_ = f.SetCellStyle(sh.name, top, bottom, pct)
		}
		lastCol, _ := excelize.ColumnNumberToName(len(sh.header))
		_ = f.SetColWidth(sh.name, "A", lastCol, 20)
	}
	buf, err := f.WriteToBuffer()
	if err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
