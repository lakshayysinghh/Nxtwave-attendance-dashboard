package http

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/importer"
	"attendance-dashboard/api/internal/stats"
)

// maxInternshipDays caps one internship period (about a year).
const maxInternshipDays = 366

// periodJSON is a stored period with its derived numbers.
type periodJSON struct {
	ID          int64  `json:"id"`
	Kind        string `json:"kind"` // INTERNSHIP or REGISTRATION_PENDING
	Start       string `json:"start"`
	End         string `json:"end"`
	CompletedOn string `json:"completed_on"` // registration only; "" while pending
	Source      string `json:"source"`       // admin or import
	State       string `json:"state"`        // upcoming, active, ended, pending, completed, cancelled
	// CalendarDays is every day from start to end; AttendanceDays the days in
	// it that count for the student up to today.
	CalendarDays   int    `json:"calendar_days"`
	AttendanceDays int    `json:"attendance_days"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
	CancelledAt    string `json:"cancelled_at"`
}

func toStatsPeriod(p db.StudentPeriod) stats.Period {
	sp := stats.Period{ID: p.ID, Kind: stats.Category(p.Kind), Start: p.StartDate.Time, End: p.EndDate.Time}
	if p.CompletedOn.Valid {
		d := p.CompletedOn.Time
		sp.CompletedOn = &d
	}
	return sp
}

func timestamp(t pgtype.Timestamptz) string {
	if !t.Valid {
		return ""
	}
	return t.Time.In(stats.IST).Format(time.RFC3339)
}

func toPeriodJSON(p db.StudentPeriod, stu stats.Student, rl rules) periodJSON {
	sp := toStatsPeriod(p)
	cal, att := stats.PeriodDays(stu, sp.Start, sp.End, rl.cal, rl.terms, rl.today)
	out := periodJSON{
		ID: p.ID, Kind: p.Kind, Start: stats.DateKey(sp.Start), End: stats.DateKey(sp.End), Source: p.Source,
		State:        string(stats.StateOf(sp, p.CancelledAt.Valid, rl.today)),
		CalendarDays: cal, AttendanceDays: att,
		CreatedAt: timestamp(p.CreatedAt), UpdatedAt: timestamp(p.UpdatedAt), CancelledAt: timestamp(p.CancelledAt),
	}
	if sp.CompletedOn != nil {
		out.CompletedOn = stats.DateKey(*sp.CompletedOn)
	}
	return out
}

// studentPeriods lists one student's periods; cancelled ones only when asked
// (admins see the full history, students only what stands).
func (s *Server) studentPeriods(ctx context.Context, q db.Querier, st db.GetStudentRow, rl rules, includeCancelled bool) ([]periodJSON, error) {
	rows, err := q.ListStudentPeriods(ctx, st.NiatID)
	if err != nil {
		return nil, fmt.Errorf("list periods: %w", err)
	}
	stu := statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn)
	out := []periodJSON{}
	for _, p := range rows {
		if p.CancelledAt.Valid && !includeCancelled {
			continue
		}
		out = append(out, toPeriodJSON(p, stu, rl))
	}
	return out, nil
}

// GET /api/admin/students/{niat_id}/periods: every period of the student,
// cancelled ones included.
func (s *Server) handleStudentPeriods(w http.ResponseWriter, r *http.Request) {
	st, ok := s.loadStudent(w, r, true)
	if !ok {
		return
	}
	rl, err := s.loadRules(r.Context(), calendarStart, calendarEnd)
	if err != nil {
		s.internalError(w, "load rules", err)
		return
	}
	periods, err := s.studentPeriods(r.Context(), s.store, st, rl, true)
	if err != nil {
		s.internalError(w, "student periods", err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"today": stats.DateKey(rl.today), "periods": periods})
}

// ---- Import: periods from category runs ----

// periodChange is one run of an imported sheet planned against stored periods.
type periodChange struct {
	niatID string
	kind   stats.Category
	plan   stats.RunPlan
	action string // new, extend, unchanged
	tempID int64  // negative id of a new period, so later runs can join it
}

// planImportPeriods finds every eligible row's category runs and plans each
// against the student's stored periods (read through q).
func planImportPeriods(ctx context.Context, q db.Querier, plan *attendancePlan) ([]periodChange, error) {
	ids := slices.Sorted(maps.Keys(plan.eligible))
	if len(ids) == 0 {
		return nil, nil
	}
	stored, err := q.ListActivePeriodsForStudents(ctx, ids)
	if err != nil {
		return nil, fmt.Errorf("list periods: %w", err)
	}
	existing := map[string][]stats.Period{}
	for _, p := range stored {
		existing[p.NiatID] = append(existing[p.NiatID], toStatsPeriod(p))
	}

	var out []periodChange
	nextTemp := int64(-1)
	for _, row := range plan.sheet.Rows {
		if !plan.eligible[row.NiatID] {
			continue
		}
		byDate := make(map[string]importer.AttendanceCell, len(row.Cells))
		for _, c := range row.Cells {
			byDate[stats.DateKey(c.Date)] = c
		}
		cells := make([]stats.SheetCell, 0, len(plan.sheet.Dates))
		for _, dc := range plan.sheet.Dates {
			c, marked := byDate[stats.DateKey(dc.Date)]
			cells = append(cells, stats.SheetCell{Date: dc.Date, Marked: marked, Category: stats.Category(c.Category)})
		}
		st := plan.students[row.NiatID]
		stu := statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn)
		list := existing[row.NiatID]
		for _, run := range stats.CategoryRuns(cells) {
			p := stats.PlanRun(run, list, stu, plan.rl.cal)
			ch := periodChange{niatID: row.NiatID, kind: run.Category, plan: p}
			switch {
			case p.ExtendID == 0:
				ch.action, ch.tempID = "new", nextTemp
				nextTemp--
			case len(p.MergeIDs) == 0 && samePeriod(list, p):
				ch.action = "unchanged"
			default:
				ch.action = "extend"
			}
			// The joined periods become the planned one for the next runs.
			gone := map[int64]bool{p.ExtendID: true}
			for _, id := range p.MergeIDs {
				gone[id] = true
			}
			next := make([]stats.Period, 0, len(list)+1)
			for _, e := range list {
				if !gone[e.ID] {
					next = append(next, e)
				}
			}
			id := p.ExtendID
			if id == 0 {
				id = ch.tempID
			}
			next = append(next, stats.Period{ID: id, Kind: run.Category, Start: p.Start, End: p.End, CompletedOn: p.CompletedOn})
			list = next
			out = append(out, ch)
		}
		existing[row.NiatID] = list
	}
	return out, nil
}

func samePeriod(list []stats.Period, p stats.RunPlan) bool {
	for _, e := range list {
		if e.ID == p.ExtendID {
			sameDone := (e.CompletedOn == nil) == (p.CompletedOn == nil) && (e.CompletedOn == nil || e.CompletedOn.Equal(*p.CompletedOn))
			return e.Start.Equal(p.Start) && e.End.Equal(p.End) && sameDone
		}
	}
	return false
}

func optDate(d *time.Time) pgtype.Date {
	if d == nil {
		return pgtype.Date{}
	}
	return pgDate(*d)
}

// applyImportPeriods stores planned periods inside the import transaction.
func applyImportPeriods(ctx context.Context, q *db.Queries, changes []periodChange, adminID int64) error {
	saved := map[int64]int64{}
	resolve := func(id int64) int64 {
		if id < 0 {
			return saved[id]
		}
		return id
	}
	for _, ch := range changes {
		if ch.action == "unchanged" {
			continue
		}
		if ch.plan.ExtendID == 0 {
			p, err := q.InsertPeriod(ctx, db.InsertPeriodParams{
				NiatID: ch.niatID, Kind: string(ch.kind), StartDate: pgDate(ch.plan.Start), EndDate: pgDate(ch.plan.End),
				CompletedOn: optDate(ch.plan.CompletedOn), Source: "import", AdminID: adminID,
			})
			if err != nil {
				return fmt.Errorf("insert period: %w", err)
			}
			saved[ch.tempID] = p.ID
		} else {
			_, err := q.UpdatePeriod(ctx, db.UpdatePeriodParams{
				ID: resolve(ch.plan.ExtendID), StartDate: pgDate(ch.plan.Start), EndDate: pgDate(ch.plan.End),
				CompletedOn: optDate(ch.plan.CompletedOn), AdminID: adminID,
			})
			if err != nil {
				return fmt.Errorf("update period: %w", err)
			}
		}
		for _, id := range ch.plan.MergeIDs {
			if _, err := q.CancelPeriod(ctx, db.CancelPeriodParams{ID: resolve(id), AdminID: adminID}); err != nil {
				return fmt.Errorf("merge period: %w", err)
			}
		}
	}
	return nil
}

// ---- Admin: internship periods ----

type internshipInput struct {
	Start     string `json:"start"`
	End       string `json:"end"`
	Overwrite bool   `json:"overwrite"` // existing marks on these days become Present (INTERNSHIP)
	DryRun    bool   `json:"dry_run"`   // check and report, save nothing
}

// conflictJSON is an existing mark an internship would replace.
type conflictJSON struct {
	Date     string `json:"date"`
	Status   string `json:"status"`
	Category string `json:"category"`
}

type internshipResult struct {
	DryRun       bool           `json:"dry_run"`
	Period       *periodJSON    `json:"period"` // nil on a dry run
	Days         int            `json:"days"`   // days added to the internship
	Conflicts    []conflictJSON `json:"conflicts"`
	MarksSaved   int            `json:"marks_saved"`
	MarksKept    int            `json:"marks_kept"`    // conflicting marks left as they were
	MarksRemoved int            `json:"marks_removed"` // INTERNSHIP marks on days no longer covered
}

var errDryRun = errors.New("dry run")

// overlapError is a refused write: another internship covers some of the days.
type overlapError struct{ other db.StudentPeriod }

func (e overlapError) Error() string { return "overlap" }

func (s *Server) decodeInternship(w http.ResponseWriter, r *http.Request) (internshipInput, stats.DateRange, bool) {
	var in internshipInput
	if !decodeJSON(w, r, &in) {
		return in, stats.DateRange{}, false
	}
	errs := fieldErrors{}
	from, err := parseDate(in.Start)
	if err != nil {
		errs["start"] = "Choose the first day of the internship."
	}
	to, err := parseDate(in.End)
	if err != nil {
		errs["end"] = "Choose the last day of the internship."
	}
	if len(errs) == 0 {
		switch {
		case to.Before(from):
			errs["end"] = "The last day must be on or after the first day."
		case int(to.Sub(from).Hours()/24)+1 > maxInternshipDays:
			errs["end"] = fmt.Sprintf("An internship can be at most %d days.", maxInternshipDays)
		}
	}
	if len(errs) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "Some fields need fixing.", errs)
		return in, stats.DateRange{}, false
	}
	return in, stats.DateRange{From: from, To: to}, true
}

// POST /api/admin/students/{niat_id}/internships {start, end, overwrite, dry_run}:
// assigns an internship and marks every day of it Present (INTERNSHIP).
// Existing marks on those days are kept unless overwrite is true.
func (s *Server) handleCreateInternship(w http.ResponseWriter, r *http.Request) {
	st, ok := s.loadStudent(w, r, true)
	if !ok {
		return
	}
	if st.Status != "active" {
		writeError(w, http.StatusUnprocessableEntity, "student_dropped", "This student is dropped; an internship cannot be assigned.", nil)
		return
	}
	in, rng, ok := s.decodeInternship(w, r)
	if !ok {
		return
	}
	s.writeInternship(w, r, st, nil, rng, in)
}

// PUT /api/admin/internships/{id} {start, end, overwrite, dry_run}: edits,
// extends or ends an internship. Days no longer covered lose their
// INTERNSHIP marks (marks changed by hand stay); new days are marked Present.
func (s *Server) handleUpdateInternship(w http.ResponseWriter, r *http.Request) {
	p, st, ok := s.loadInternship(w, r)
	if !ok {
		return
	}
	in, rng, ok := s.decodeInternship(w, r)
	if !ok {
		return
	}
	s.writeInternship(w, r, st, &p, rng, in)
}

func (s *Server) loadInternship(w http.ResponseWriter, r *http.Request) (db.StudentPeriod, db.GetStudentRow, bool) {
	var st db.GetStudentRow
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusNotFound, "not_found", "No such internship.", nil)
		return db.StudentPeriod{}, st, false
	}
	p, err := s.store.GetPeriod(r.Context(), id)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && p.Kind != string(stats.CategoryInternship)) {
		writeError(w, http.StatusNotFound, "not_found", "No such internship.", nil)
		return p, st, false
	}
	if err != nil {
		s.internalError(w, "load internship", err)
		return p, st, false
	}
	if p.CancelledAt.Valid {
		writeError(w, http.StatusConflict, "cancelled", "This internship was cancelled; assign a new one instead.", nil)
		return p, st, false
	}
	if st, err = s.store.GetStudent(r.Context(), p.NiatID); err != nil {
		s.internalError(w, "load student", err)
		return p, st, false
	}
	return p, st, true
}

// writeInternship creates (old nil) or changes an internship and its marks
// in one transaction, with the student locked so two admins cannot create
// overlapping periods at once.
func (s *Server) writeInternship(w http.ResponseWriter, r *http.Request, st db.GetStudentRow, old *db.StudentPeriod, rng stats.DateRange, in internshipInput) {
	ctx := r.Context()
	adminID := adminFrom(ctx).ID
	res := internshipResult{DryRun: in.DryRun, Conflicts: []conflictJSON{}}
	var saved db.StudentPeriod
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		if _, err := q.LockStudents(ctx, []string{st.NiatID}); err != nil {
			return err
		}
		all, err := q.ListStudentPeriods(ctx, st.NiatID)
		if err != nil {
			return err
		}
		for _, p := range all {
			if p.Kind != string(stats.CategoryInternship) || p.CancelledAt.Valid || (old != nil && p.ID == old.ID) {
				continue
			}
			if !p.StartDate.Time.After(rng.To) && !p.EndDate.Time.Before(rng.From) {
				return overlapError{p}
			}
		}

		// Days no longer covered lose their INTERNSHIP marks.
		var oldRange *stats.DateRange
		if old != nil {
			oldRange = &stats.DateRange{From: old.StartDate.Time, To: old.EndDate.Time}
			for _, gone := range stats.RemovedRanges(*oldRange, rng) {
				n, err := q.DeleteCategoryMarks(ctx, db.DeleteCategoryMarksParams{
					NiatID: st.NiatID, Category: string(stats.CategoryInternship), FromDate: pgDate(gone.From), ToDate: pgDate(gone.To),
				})
				if err != nil {
					return err
				}
				res.MarksRemoved += int(n)
			}
		}

		// New days are marked Present, keeping or overwriting what is there.
		marks, cats, err := s.loadMarksWithCategories(ctx, q, []string{st.NiatID}, rng.From, rng.To)
		if err != nil {
			return err
		}
		add := db.UpsertMarksParams{UpdatedBy: adminID}
		for _, d := range stats.DatesBetween(rng.From, rng.To) {
			if oldRange != nil && !d.Before(oldRange.From) && !d.After(oldRange.To) {
				continue
			}
			key := stats.DateKey(d)
			if cur, cat := marks[st.NiatID][key], cats.of(st.NiatID, key); stats.IsInternshipConflict(cur, cat) {
				res.Conflicts = append(res.Conflicts, conflictJSON{Date: key, Status: markString(cur), Category: string(cat)})
			}
			add.NiatIds = append(add.NiatIds, st.NiatID)
			add.Dates = append(add.Dates, pgDate(d))
			add.Statuses = append(add.Statuses, "P")
			add.Categories = append(add.Categories, string(stats.CategoryInternship))
		}
		res.Days = len(add.NiatIds)
		if len(add.NiatIds) > 0 {
			var n int64
			if in.Overwrite {
				n, err = q.UpsertMarks(ctx, add)
			} else {
				n, err = q.InsertMarksKeepExisting(ctx, db.InsertMarksKeepExistingParams(add))
				res.MarksKept = len(res.Conflicts)
			}
			if err != nil {
				return err
			}
			res.MarksSaved = int(n)
		}

		if old == nil {
			saved, err = q.InsertPeriod(ctx, db.InsertPeriodParams{
				NiatID: st.NiatID, Kind: string(stats.CategoryInternship), StartDate: pgDate(rng.From), EndDate: pgDate(rng.To),
				Source: "admin", AdminID: adminID,
			})
		} else {
			saved, err = q.UpdatePeriod(ctx, db.UpdatePeriodParams{
				ID: old.ID, StartDate: pgDate(rng.From), EndDate: pgDate(rng.To), AdminID: adminID,
			})
		}
		if err != nil {
			return err
		}
		if in.DryRun {
			return errDryRun
		}
		return nil
	})
	var overlap overlapError
	switch {
	case errors.As(err, &overlap):
		writeError(w, http.StatusConflict, "overlap",
			fmt.Sprintf("This student already has an internship from %s to %s; edit or cancel it instead.",
				overlap.other.StartDate.Time.Format("2 Jan 2006"), overlap.other.EndDate.Time.Format("2 Jan 2006")),
			map[string]any{"id": overlap.other.ID, "start": stats.DateKey(overlap.other.StartDate.Time), "end": stats.DateKey(overlap.other.EndDate.Time)})
		return
	case errors.Is(err, errDryRun):
		res.MarksSaved, res.MarksRemoved = 0, 0
		writeJSON(w, http.StatusOK, res)
		return
	case err != nil:
		s.internalError(w, "save internship", err)
		return
	}
	rl, err := s.loadRules(ctx, calendarStart, calendarEnd)
	if err != nil {
		s.internalError(w, "load rules", err)
		return
	}
	pj := toPeriodJSON(saved, statsStudent(st.DegreeCode, st.Status, st.JoinedOn, st.DroppedOn), rl)
	res.Period = &pj
	s.log.Info("internship saved", "admin_id", adminID, "niat_id", st.NiatID, "period_id", saved.ID,
		"start", stats.DateKey(rng.From), "end", stats.DateKey(rng.To), "marks_saved", res.MarksSaved, "marks_removed", res.MarksRemoved)
	status := http.StatusOK
	if old == nil {
		status = http.StatusCreated
	}
	writeJSON(w, status, res)
}

// POST /api/admin/internships/{id}/cancel: cancels the internship and removes
// its INTERNSHIP marks (marks changed by hand stay). The period is kept, as
// cancelled, for history.
func (s *Server) handleCancelInternship(w http.ResponseWriter, r *http.Request) {
	p, st, ok := s.loadInternship(w, r)
	if !ok {
		return
	}
	ctx := r.Context()
	adminID := adminFrom(ctx).ID
	var removed int64
	err := pgx.BeginFunc(ctx, s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		if _, err := q.LockStudents(ctx, []string{st.NiatID}); err != nil {
			return err
		}
		var err error
		if _, err = q.CancelPeriod(ctx, db.CancelPeriodParams{ID: p.ID, AdminID: adminID}); err != nil {
			return err // pgx.ErrNoRows: cancelled meanwhile
		}
		removed, err = q.DeleteCategoryMarks(ctx, db.DeleteCategoryMarksParams{
			NiatID: st.NiatID, Category: string(stats.CategoryInternship), FromDate: p.StartDate, ToDate: p.EndDate,
		})
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "cancelled", "This internship was already cancelled.", nil)
		return
	}
	if err != nil {
		s.internalError(w, "cancel internship", err)
		return
	}
	s.log.Info("internship cancelled", "admin_id", adminID, "niat_id", st.NiatID, "period_id", p.ID, "marks_removed", removed)
	writeJSON(w, http.StatusOK, map[string]any{"cancelled": p.ID, "marks_removed": removed})
}

// internshipListJSON is an internship on the admin calendar, with its student.
type internshipListJSON struct {
	periodJSON
	NiatID  string `json:"niat_id"`
	Name    string `json:"name"`
	Degree  string `json:"degree"`
	Section string `json:"section"`
	HallNo  string `json:"hall_no"`
	Current bool   `json:"current"` // the internship covers today
}

// GET /api/admin/internships?from=YYYY-MM-DD&to=YYYY-MM-DD (default: this
// month): internships that touch the range, for every student.
func (s *Server) handleListInternships(w http.ResponseWriter, r *http.Request) {
	rl, err := s.loadRules(r.Context(), calendarStart, calendarEnd)
	if err != nil {
		s.internalError(w, "load rules", err)
		return
	}
	from := stats.Date(rl.today.Year(), rl.today.Month(), 1)
	to := from.AddDate(0, 1, -1)
	for name, dst := range map[string]*time.Time{"from": &from, "to": &to} {
		if v := r.URL.Query().Get(name); v != "" {
			d, err := parseDate(v)
			if err != nil {
				writeError(w, http.StatusBadRequest, "bad_request", fmt.Sprintf("%s: %v", name, err), nil)
				return
			}
			*dst = d
		}
	}
	if to.Before(from) || to.Sub(from) > 400*24*time.Hour {
		writeError(w, http.StatusBadRequest, "bad_request", "Choose a range of at most 400 days, from before to.", nil)
		return
	}
	rows, err := s.store.ListPeriodsOverlapping(r.Context(), db.ListPeriodsOverlappingParams{
		Kind: string(stats.CategoryInternship), FromDate: pgDate(from), ToDate: pgDate(to),
	})
	if err != nil {
		s.internalError(w, "list internships", err)
		return
	}
	out := make([]internshipListJSON, 0, len(rows))
	current := 0
	for _, p := range rows {
		sp := db.StudentPeriod{
			ID: p.ID, NiatID: p.NiatID, Kind: p.Kind, StartDate: p.StartDate, EndDate: p.EndDate, CompletedOn: p.CompletedOn,
			Source: p.Source, CancelledAt: p.CancelledAt, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		}
		item := internshipListJSON{
			periodJSON: toPeriodJSON(sp, stats.Student{Degree: p.DegreeCode}, rl),
			NiatID:     p.NiatID, Name: p.FullName, Degree: p.DegreeCode, Section: p.Section, HallNo: optText(p.HallNo),
		}
		item.Current = item.State == string(stats.StateActive)
		if item.Current {
			current++
		}
		out = append(out, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"from": stats.DateKey(from), "to": stats.DateKey(to), "today": stats.DateKey(rl.today),
		"current": current, "internships": out,
	})
}
