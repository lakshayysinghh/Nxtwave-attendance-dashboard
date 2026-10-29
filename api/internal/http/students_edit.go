package http

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/importer"
)

// studentInput is the add/edit form. Blank optional fields are stored as
// empty (NULL). POC and coach are names; a new name creates the mentor, as
// the student import does.
type studentInput struct {
	NiatID    string `json:"niat_id"` // create only; the NIAT ID cannot be changed
	Name      string `json:"name"`
	Degree    string `json:"degree"`
	Section   string `json:"section"`
	Level     string `json:"level"`
	HallNo    string `json:"hall_no"`
	POC       string `json:"poc"`
	Coach     string `json:"coach"`
	Status    string `json:"status"`     // "active" (default) or "dropped"
	JoinedOn  string `json:"joined_on"`  // YYYY-MM-DD or ""
	DroppedOn string `json:"dropped_on"` // required when dropped
}

// studentFields is a validated studentInput.
type studentFields struct {
	name, degree, section, level, hall, poc, coach, status string
	joined, dropped                                        pgtype.Date
}

// fieldErrors maps a form field to its message, returned as error details.
type fieldErrors map[string]string

func clean(s string) string { return strings.Join(strings.Fields(s), " ") }

// validateStudent checks the form. Dates are calendar dates (DATE, no time).
func validateStudent(in studentInput, degrees map[string]bool) (studentFields, fieldErrors) {
	errs := fieldErrors{}
	f := studentFields{
		name: clean(in.Name), degree: strings.ToUpper(clean(in.Degree)), section: strings.ToUpper(clean(in.Section)),
		level: clean(in.Level), hall: importer.NormaliseHall(in.HallNo), poc: clean(in.POC), coach: clean(in.Coach),
		status: strings.ToLower(clean(in.Status)),
	}
	if f.name == "" || len(f.name) > 100 {
		errs["name"] = "Enter the student's full name (up to 100 characters)."
	}
	if !degrees[f.degree] {
		errs["degree"] = "Choose BITS or CDU."
	}
	if f.section == "" || len(f.section) > 20 {
		errs["section"] = "Enter the section, e.g. S001."
	}
	for field, v := range map[string]string{"level": f.level, "hall_no": f.hall, "poc": f.poc, "coach": f.coach} {
		if len(v) > 100 {
			errs[field] = "Up to 100 characters."
		}
	}
	if f.status == "" {
		f.status = "active"
	}
	if f.status != "active" && f.status != "dropped" {
		errs["status"] = `Status must be "active" or "dropped".`
	}
	if v := strings.TrimSpace(in.JoinedOn); v != "" {
		if d, err := parseDate(v); err != nil {
			errs["joined_on"] = "Use a date like 2026-08-19."
		} else {
			f.joined = pgDate(d)
		}
	}
	if f.status == "dropped" {
		d, err := parseDate(strings.TrimSpace(in.DroppedOn))
		switch {
		case err != nil:
			errs["dropped_on"] = "Enter the date the student dropped."
		case f.joined.Valid && d.Before(f.joined.Time):
			errs["dropped_on"] = "The drop date cannot be before the join date."
		default:
			f.dropped = pgDate(d)
		}
	}
	return f, errs
}

// mentorID returns the id of the named mentor, creating it if new; NULL for a blank name.
func mentorID(ctx context.Context, q *db.Queries, kind, name string) (pgtype.Int8, error) {
	if name == "" {
		return pgtype.Int8{}, nil
	}
	if err := q.InsertMentorIfMissing(ctx, db.InsertMentorIfMissingParams{Name: name, Kind: kind}); err != nil {
		return pgtype.Int8{}, err
	}
	m, err := q.GetMentorByName(ctx, db.GetMentorByNameParams{Kind: kind, Name: name})
	if err != nil {
		return pgtype.Int8{}, err
	}
	return pgtype.Int8{Int64: m.ID, Valid: true}, nil
}

// decodeStudent reads and validates the form, writing a 422 with per-field
// details when it is invalid. It also returns the NIAT ID pattern for create.
func (s *Server) decodeStudent(w http.ResponseWriter, r *http.Request) (studentInput, studentFields, *regexp.Regexp, bool) {
	var in studentInput
	if !decodeJSON(w, r, &in) {
		return in, studentFields{}, nil, false
	}
	pattern, degrees, err := s.importRules(r)
	if err != nil {
		s.internalError(w, "student rules", err)
		return in, studentFields{}, nil, false
	}
	f, errs := validateStudent(in, degrees)
	if len(errs) > 0 {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "Some fields need fixing.", errs)
		return in, f, nil, false
	}
	return in, f, pattern, true
}

// POST /api/admin/students: add one student. 409 if the NIAT ID exists.
func (s *Server) handleCreateStudent(w http.ResponseWriter, r *http.Request) {
	in, f, pattern, ok := s.decodeStudent(w, r)
	if !ok {
		return
	}
	id := normaliseNiatID(in.NiatID)
	if !pattern.MatchString(id) {
		writeError(w, http.StatusUnprocessableEntity, "validation_failed", "Some fields need fixing.",
			fieldErrors{"niat_id": fmt.Sprintf("%q does not match the NIAT ID format (like N24H01A0598).", id)})
		return
	}
	var created db.Student
	err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		poc, err := mentorID(r.Context(), q, "poc", f.poc)
		if err != nil {
			return err
		}
		coach, err := mentorID(r.Context(), q, "coach", f.coach)
		if err != nil {
			return err
		}
		created, err = q.CreateStudent(r.Context(), db.CreateStudentParams{
			NiatID: id, FullName: f.name, DegreeCode: f.degree, Section: f.section,
			Level: optionalText(f.level), HallNo: optionalText(f.hall), PocID: poc, CoachID: coach,
			Status: f.status, JoinedOn: f.joined, DroppedOn: f.dropped,
		})
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusConflict, "duplicate_niat_id", fmt.Sprintf("A student with NIAT ID %s already exists.", id), nil)
		return
	}
	if err != nil {
		s.internalError(w, "create student", err)
		return
	}
	s.log.Info("student created", "admin_id", adminFrom(r.Context()).ID, "niat_id", created.NiatID)
	writeJSON(w, http.StatusCreated, map[string]string{"niat_id": created.NiatID})
}

// PUT /api/admin/students/{niat_id}: replace every editable field. Marking a
// student dropped (with a date) is the reversible way to remove them: their
// marks stay, and days after the drop date stop counting.
func (s *Server) handleUpdateStudent(w http.ResponseWriter, r *http.Request) {
	st, ok := s.loadStudent(w, r, true)
	if !ok {
		return
	}
	_, f, _, ok := s.decodeStudent(w, r)
	if !ok {
		return
	}
	err := pgx.BeginFunc(r.Context(), s.pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		poc, err := mentorID(r.Context(), q, "poc", f.poc)
		if err != nil {
			return err
		}
		coach, err := mentorID(r.Context(), q, "coach", f.coach)
		if err != nil {
			return err
		}
		_, err = q.UpdateStudent(r.Context(), db.UpdateStudentParams{
			NiatID: st.NiatID, FullName: f.name, DegreeCode: f.degree, Section: f.section,
			Level: optionalText(f.level), HallNo: optionalText(f.hall), PocID: poc, CoachID: coach,
			Status: f.status, JoinedOn: f.joined, DroppedOn: f.dropped,
		})
		return err
	})
	if err != nil {
		s.internalError(w, "update student", err)
		return
	}
	s.log.Info("student updated", "admin_id", adminFrom(r.Context()).ID, "niat_id", st.NiatID, "status", f.status)
	writeJSON(w, http.StatusOK, map[string]string{"niat_id": st.NiatID})
}

// DELETE /api/admin/students/{niat_id}?confirm=<NIAT ID> (Owner only):
// deletes the student and all their marks. confirm must repeat the NIAT ID,
// so a stray request cannot delete anyone.
func (s *Server) handleDeleteStudent(w http.ResponseWriter, r *http.Request) {
	st, ok := s.loadStudent(w, r, true)
	if !ok {
		return
	}
	if normaliseNiatID(r.URL.Query().Get("confirm")) != st.NiatID {
		writeError(w, http.StatusUnprocessableEntity, "confirm_required", "Type the student's NIAT ID to confirm the deletion.", nil)
		return
	}
	marks, err := s.store.CountStudentMarks(r.Context(), st.NiatID)
	if err != nil {
		s.internalError(w, "count marks", err)
		return
	}
	if _, err := s.store.DeleteStudent(r.Context(), st.NiatID); err != nil {
		s.internalError(w, "delete student", err)
		return
	}
	s.log.Info("student deleted", "admin_id", adminFrom(r.Context()).ID, "niat_id", st.NiatID, "marks_deleted", marks)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": st.NiatID, "marks_deleted": marks})
}
