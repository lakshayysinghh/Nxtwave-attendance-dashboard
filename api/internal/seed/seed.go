// Package seed loads the MVP demo data. It is idempotent: every insert skips
// rows that already exist (by natural key), so running it again changes
// nothing, and it never overwrites marks an admin has edited. Demo students
// all have NIAT IDs starting with N99; ClearDemo removes only those.
package seed

import (
	"context"
	"errors"
	"fmt"
	"hash/fnv"
	"math/rand/v2"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"attendance-dashboard/api/internal/db"
	"attendance-dashboard/api/internal/stats"
)

const (
	studentsPerSection = 4
	markBatch          = 5000
)

var (
	termStart = stats.Date(2026, 8, 19)
	termEnd   = stats.Date(2026, 12, 20)
	degrees   = []struct{ code, name string }{{"BITS", "BITS"}, {"CDU", "CDU"}}
	sections  = []string{"S001"}
	pocs      = []string{"Ananya Iyer", "Rahul Verma", "Meera Nair", "Karthik Reddy"}
	coaches   = []string{"Divya Menon", "Arjun Patel", "Sneha Kulkarni"}

	firstNames = []string{"Aarav", "Diya", "Vihaan", "Ishita", "Aditya", "Saanvi", "Reyansh", "Anika", "Krishna", "Myra",
		"Arjun", "Kavya", "Sai", "Riya", "Rohan", "Tanvi", "Kabir", "Nisha", "Dev", "Pooja", "Yash", "Sneha", "Nikhil",
		"Aisha", "Varun", "Meghana", "Harsha", "Lakshmi", "Pranav", "Shreya", "Siddharth", "Bhavya", "Manish"}
	lastNames = []string{"Sharma", "Reddy", "Patel", "Iyer", "Nair", "Gupta", "Rao", "Singh", "Kumar", "Joshi", "Menon",
		"Das", "Kulkarni", "Chowdary", "Pillai", "Verma", "Mehta", "Naidu", "Bose", "Shetty", "Varma", "Agarwal"}
)

// Holidays for all degrees; Sundays are off by default and need no rows.
func holidays() []stats.CalendarEntry {
	h := []stats.CalendarEntry{
		{Date: stats.Date(2026, 8, 26), Label: "Holiday"},
		{Date: stats.Date(2026, 9, 14), Label: "Holiday"},
		{Date: stats.Date(2026, 10, 2), Label: "Gandhi Jayanti"},
	}
	for d := stats.Date(2026, 10, 16); !d.After(stats.Date(2026, 10, 25)); d = d.AddDate(0, 0, 1) {
		h = append(h, stats.CalendarEntry{Date: d, Label: "Mid-semester break"})
	}
	for i := range h {
		h[i].AppliesTo, h[i].DayType = "ALL", stats.KindHoliday
	}
	return h
}

type Result struct {
	StudentsInserted int64
	MarksInserted    int64
	MarkedUntil      time.Time
}

// Run seeds the demo data in one transaction. today is the IST date; marks
// are created up to the day before it, so today is left for marking.
func Run(ctx context.Context, pool *pgxpool.Pool, ownerEmail string, today time.Time) (Result, error) {
	if ownerEmail == "" {
		return Result{}, errors.New("OWNER_EMAIL must be set: the seed creates it as the owner admin for dev login")
	}
	var res Result
	err := pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := db.New(tx)

		if _, err := q.UpsertOwner(ctx, ownerEmail); err != nil {
			return fmt.Errorf("owner admin: %w", err)
		}
		for _, d := range degrees {
			if err := q.InsertDegreeIfMissing(ctx, db.InsertDegreeIfMissingParams{Code: d.code, Name: d.name}); err != nil {
				return fmt.Errorf("degree %s: %w", d.code, err)
			}
		}
		if err := q.InsertTermIfMissing(ctx, db.InsertTermIfMissingParams{
			Name: "Sem 1", StartDate: pgDate(termStart), EndDate: pgDate(termEnd), IsCurrent: true,
		}); err != nil {
			return fmt.Errorf("term: %w", err)
		}
		for _, h := range holidays() {
			if err := q.InsertCalendarDayIfMissing(ctx, db.InsertCalendarDayIfMissingParams{
				Date: pgDate(h.Date), AppliesTo: h.AppliesTo, DayType: string(h.DayType), Counts: false, Label: h.Label,
			}); err != nil {
				return fmt.Errorf("holiday %s: %w", stats.DateKey(h.Date), err)
			}
		}

		pocIDs, err := mentorIDs(ctx, q, "poc", pocs)
		if err != nil {
			return err
		}
		coachIDs, err := mentorIDs(ctx, q, "coach", coaches)
		if err != nil {
			return err
		}

		students := demoStudents(pocIDs, coachIDs)
		for _, s := range students {
			n, err := q.InsertStudentIfMissing(ctx, s)
			if err != nil {
				return fmt.Errorf("student %s: %w", s.NiatID, err)
			}
			res.StudentsInserted += n
		}

		// Resolve days with the same rules the app uses.
		terms, cal, err := loadRules(ctx, q)
		if err != nil {
			return err
		}
		yesterday := today.AddDate(0, 0, -1)
		res.MarkedUntil = yesterday
		var batch markRows
		for _, s := range students {
			stu := stats.Student{Degree: s.DegreeCode}
			if s.JoinedOn.Valid {
				j := s.JoinedOn.Time
				stu.JoinedOn = &j
			}
			rng := studentRNG(s.NiatID)
			p := attendanceRate(rng)
			for d := termStart; !d.After(yesterday) && !d.After(termEnd); d = d.AddDate(0, 0, 1) {
				if !stats.ResolveDay(d, stu, cal, terms, today).Counted {
					continue
				}
				for half := int16(1); half <= 2; half++ {
					r := rng.Float64()
					switch {
					case r < 0.012: // a few sessions left unmarked, to show "Not marked"
						continue
					case rng.Float64() < p:
						batch.add(s.NiatID, d, half, "P")
					default:
						batch.add(s.NiatID, d, half, "A")
					}
				}
			}
			if len(batch.ids) >= markBatch {
				n, err := batch.flush(ctx, q)
				if err != nil {
					return err
				}
				res.MarksInserted += n
			}
		}
		n, err := batch.flush(ctx, q)
		res.MarksInserted += n
		return err
	})
	return res, err
}

// ClearDemo deletes only N99 students and their marks.
func ClearDemo(ctx context.Context, pool *pgxpool.Pool) (students, marks int64, err error) {
	err = pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		q := db.New(tx)
		if marks, err = q.DeleteDemoMarks(ctx); err != nil {
			return err
		}
		students, err = q.DeleteDemoStudents(ctx)
		return err
	})
	return students, marks, err
}

func mentorIDs(ctx context.Context, q *db.Queries, kind string, names []string) ([]int64, error) {
	ids := make([]int64, len(names))
	for i, name := range names {
		if err := q.InsertMentorIfMissing(ctx, db.InsertMentorIfMissingParams{Name: name, Kind: kind}); err != nil {
			return nil, fmt.Errorf("mentor %s: %w", name, err)
		}
		m, err := q.GetMentorByName(ctx, db.GetMentorByNameParams{Kind: kind, Name: name})
		if err != nil {
			return nil, fmt.Errorf("mentor %s: %w", name, err)
		}
		ids[i] = m.ID
	}
	return ids, nil
}

// demoStudents builds 4 sections × 35 students per degree, N99H01A0001 onwards.
func demoStudents(pocIDs, coachIDs []int64) []db.InsertStudentIfMissingParams {
	var out []db.InsertStudentIfMissingParams
	n := 0
	for _, d := range degrees {
		for si, sec := range sections {
			for k := 0; k < studentsPerSection; k++ {
				n++
				s := db.InsertStudentIfMissingParams{
					NiatID:     fmt.Sprintf("N99H01A%04d", n),
					FullName:   firstNames[n%len(firstNames)] + " " + lastNames[(n*7+si)%len(lastNames)],
					DegreeCode: d.code,
					Section:    sec,
					Level:      pgtype.Text{String: fmt.Sprintf("Level %d", 1+n%2), Valid: true},
					HallNo:     pgtype.Text{String: fmt.Sprintf("Hall %d", 1+si), Valid: true},
					PocID:      pgtype.Int8{Int64: pocIDs[si%len(pocIDs)], Valid: true},
					CoachID:    pgtype.Int8{Int64: coachIDs[n%len(coachIDs)], Valid: true},
				}
				if n%40 == 0 { // a few late joiners
					s.JoinedOn = pgDate(stats.Date(2026, 9, 15))
				}
				out = append(out, s)
			}
		}
	}
	return out
}

// attendanceRate gives most students about 85%, some under 60% and some
// above 90%, for roughly 80% overall.
func attendanceRate(rng *rand.Rand) float64 {
	switch r := rng.Float64(); {
	case r < 0.12:
		return 0.40 + rng.Float64()*0.15
	case r < 0.30:
		return 0.93 + rng.Float64()*0.07
	default:
		return 0.78 + rng.Float64()*0.12
	}
}

// studentRNG is deterministic per student, so a re-run generates the same marks.
func studentRNG(niatID string) *rand.Rand {
	h := fnv.New64a()
	_, _ = h.Write([]byte(niatID))
	return rand.New(rand.NewPCG(h.Sum64(), 0x5eed))
}

func loadRules(ctx context.Context, q *db.Queries) ([]stats.Term, stats.Calendar, error) {
	dbTerms, err := q.ListTerms(ctx)
	if err != nil {
		return nil, stats.Calendar{}, err
	}
	terms := make([]stats.Term, len(dbTerms))
	for i, t := range dbTerms {
		terms[i] = stats.Term{ID: t.ID, Name: t.Name, Start: t.StartDate.Time, End: t.EndDate.Time, IsCurrent: t.IsCurrent}
	}
	days, err := q.ListCalendarDays(ctx, db.ListCalendarDaysParams{FromDate: pgDate(termStart), ToDate: pgDate(termEnd)})
	if err != nil {
		return nil, stats.Calendar{}, err
	}
	entries := make([]stats.CalendarEntry, len(days))
	for i, d := range days {
		entries[i] = stats.CalendarEntry{Date: d.Date.Time, AppliesTo: d.AppliesTo, DayType: stats.Kind(d.DayType), Counts: d.Counts, Label: d.Label}
	}
	return terms, stats.NewCalendar(entries), nil
}

type markRows struct {
	ids      []string
	dates    []pgtype.Date
	halves   []int16
	statuses []string
}

func (m *markRows) add(id string, d time.Time, half int16, status string) {
	m.ids = append(m.ids, id)
	m.dates = append(m.dates, pgDate(d))
	m.halves = append(m.halves, half)
	m.statuses = append(m.statuses, status)
}

func (m *markRows) flush(ctx context.Context, q *db.Queries) (int64, error) {
	if len(m.ids) == 0 {
		return 0, nil
	}
	n, err := q.InsertMarksIfMissing(ctx, db.InsertMarksIfMissingParams{
		NiatIds: m.ids, Dates: m.dates, Halves: m.halves, Statuses: m.statuses,
	})
	*m = markRows{}
	if err != nil {
		return 0, fmt.Errorf("insert marks: %w", err)
	}
	return n, nil
}

func pgDate(t time.Time) pgtype.Date { return pgtype.Date{Time: t, Valid: true} }
