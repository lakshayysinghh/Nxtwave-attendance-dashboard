package stats

import (
	"math"
	"sort"
	"time"
)

// Analytics: attendance totals for a group of students over a period, for the
// Owner's analytics page.
//
// Rules, on top of ResolveDay and Summarize:
//   - A student-day is looked at only when the day counts for the student
//     (term, calendar, join/drop, not in the future).
//   - A date is a working day for a degree when at least one student of that
//     degree (any hall, before filters) has a mark on it. Dates nobody was
//     marked on are not working days, so a day that was never uploaded does
//     not turn into "unmarked" for everyone (the same "only marked days" rule
//     as Summary.MarkedDays).
//   - On a working day a counted student-day is Present, Absent or Unmarked.
//     Unmarked is never counted as Absent: % = present ÷ (present + absent).
//   - A student is eligible when they have at least one such student-day.
//   - Over several days Present / Absent are student-days, not students;
//     AvgPresent = present ÷ working days is the average present per day.

// AnalyticsStudent is one student with their marks over the period.
type AnalyticsStudent struct {
	Student  Student
	Hall     string // "" when the student has no hall
	Marks    Marks
	Selected bool // matches the page filters; unselected students only decide working days
}

// Tally counts student-days for a group.
type Tally struct {
	Students         int      `json:"students"` // eligible students
	Present          int      `json:"present"`
	Absent           int      `json:"absent"`
	Unmarked         int      `json:"unmarked"`
	UnmarkedStudents int      `json:"unmarked_students"` // students with at least one unmarked working day
	WorkingDays      int      `json:"working_days"`
	Pct              *float64 `json:"pct"`         // nil when nothing is marked
	AvgPresent       *float64 `json:"avg_present"` // present per working day; nil with no working days
	AvgAbsent        *float64 `json:"avg_absent"`  // absent per working day; nil with no working days
}

// GroupTally is a Tally for one degree, or one hall of one degree.
type GroupTally struct {
	Degree string `json:"degree"`
	Hall   string `json:"hall,omitempty"`
	Tally
}

// DayTally is one working day.
type DayTally struct {
	Date     string   `json:"date"`
	Students int      `json:"students"` // eligible that day
	Present  int      `json:"present"`
	Absent   int      `json:"absent"`
	Unmarked int      `json:"unmarked"`
	Pct      *float64 `json:"pct"`
}

// Analytics is the whole breakdown for the selected students.
type Analytics struct {
	Total   Tally        `json:"total"`
	Degrees []GroupTally `json:"degrees"`
	Halls   []GroupTally `json:"halls"`
	Daily   []DayTally   `json:"daily"`
}

type tallyAcc struct {
	t        Tally
	students map[int]bool
	unmarked map[int]bool
	days     map[string]bool
}

func newAcc() *tallyAcc {
	return &tallyAcc{students: map[int]bool{}, unmarked: map[int]bool{}, days: map[string]bool{}}
}

func (a *tallyAcc) add(i int, key string, st Status) {
	a.students[i] = true
	a.days[key] = true
	switch st {
	case Present:
		a.t.Present++
	case Absent:
		a.t.Absent++
	default:
		a.t.Unmarked++
		a.unmarked[i] = true
	}
}

func (a *tallyAcc) done() Tally {
	t := a.t
	t.Students, t.UnmarkedStudents, t.WorkingDays = len(a.students), len(a.unmarked), len(a.days)
	t.Pct = pct2(t.Present, t.Present+t.Absent)
	if t.WorkingDays > 0 {
		v := math.Round(float64(t.Present)*10/float64(t.WorkingDays)) / 10
		t.AvgPresent = &v
		ab := math.Round(float64(t.Absent)*10/float64(t.WorkingDays)) / 10
		t.AvgAbsent = &ab
	}
	return t
}

// pct2 is part ÷ whole × 100 to two decimals; nil when whole is 0.
func pct2(part, whole int) *float64 {
	if whole == 0 {
		return nil
	}
	v := math.Round(float64(part)*10000/float64(whole)) / 100
	return &v
}

// eachStudentDay calls fn for every counted working day of every selected
// student in from..to, with that day's mark (NotMarked when blank).
func eachStudentDay(students []AnalyticsStudent, from, to time.Time, cal Calendar, terms []Term, today time.Time, fn func(i int, key string, st Status)) {
	// Working days per degree, from every student's marks on counted days.
	working := map[string]map[string]bool{}
	for _, s := range students {
		for key, st := range s.Marks {
			if st == NotMarked {
				continue
			}
			d, err := time.Parse(time.DateOnly, key)
			if err != nil || d.Before(from) || d.After(to) || !ResolveDay(d, s.Student, cal, terms, today).Counted {
				continue
			}
			if working[s.Student.Degree] == nil {
				working[s.Student.Degree] = map[string]bool{}
			}
			working[s.Student.Degree][key] = true
		}
	}

	for i, s := range students {
		if !s.Selected {
			continue
		}
		w := working[s.Student.Degree]
		for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
			key := DateKey(d)
			if w[key] && ResolveDay(d, s.Student, cal, terms, today).Counted {
				fn(i, key, s.Marks[key])
			}
		}
	}
}

// Analyze builds the breakdown for from..to inclusive.
func Analyze(students []AnalyticsStudent, from, to time.Time, cal Calendar, terms []Term, today time.Time) Analytics {
	total := newAcc()
	degrees := map[string]*tallyAcc{}
	halls := map[[2]string]*tallyAcc{}
	daily := map[string]*tallyAcc{}
	eachStudentDay(students, from, to, cal, terms, today, func(i int, key string, st Status) {
		s := students[i]
		deg, hk := s.Student.Degree, [2]string{s.Student.Degree, s.Hall}
		if degrees[deg] == nil {
			degrees[deg] = newAcc()
		}
		if halls[hk] == nil {
			halls[hk] = newAcc()
		}
		if daily[key] == nil {
			daily[key] = newAcc()
		}
		for _, a := range []*tallyAcc{total, degrees[deg], halls[hk], daily[key]} {
			a.add(i, key, st)
		}
	})

	out := Analytics{Total: total.done(), Degrees: []GroupTally{}, Halls: []GroupTally{}, Daily: []DayTally{}}
	for deg, a := range degrees {
		out.Degrees = append(out.Degrees, GroupTally{Degree: deg, Tally: a.done()})
	}
	sort.Slice(out.Degrees, func(i, j int) bool { return out.Degrees[i].Degree < out.Degrees[j].Degree })
	for hk, a := range halls {
		out.Halls = append(out.Halls, GroupTally{Degree: hk[0], Hall: hk[1], Tally: a.done()})
	}
	sort.Slice(out.Halls, func(i, j int) bool {
		a, b := out.Halls[i], out.Halls[j]
		if a.Degree != b.Degree {
			return a.Degree < b.Degree
		}
		return HallLess(a.Hall, b.Hall)
	})
	for key, a := range daily {
		t := a.done()
		out.Daily = append(out.Daily, DayTally{Date: key, Students: t.Students, Present: t.Present, Absent: t.Absent, Unmarked: t.Unmarked, Pct: t.Pct})
	}
	sort.Slice(out.Daily, func(i, j int) bool { return out.Daily[i].Date < out.Daily[j].Date })
	return out
}

// HallLess orders halls by their number ("Hall 2" before "Hall 15"), with
// "no hall" last.
func HallLess(a, b string) bool {
	if a == "" || b == "" {
		return b == "" && a != ""
	}
	na, nb := leadingNumber(a), leadingNumber(b)
	if na != nb {
		return na < nb
	}
	return a < b
}

// leadingNumber is the first run of digits in s, or MaxInt when there is none.
func leadingNumber(s string) int {
	n, seen := 0, false
	for _, r := range s {
		if r >= '0' && r <= '9' {
			n, seen = n*10+int(r-'0'), true
		} else if seen {
			break
		}
	}
	if !seen {
		return math.MaxInt
	}
	return n
}

// PreviousPeriod is the period of the same length ending the day before from.
func PreviousPeriod(from, to time.Time) (time.Time, time.Time) {
	days := int(to.Sub(from).Hours()/24) + 1
	return from.AddDate(0, 0, -days), from.AddDate(0, 0, -1)
}

// Insights are the plain facts the page highlights. Names are lists because
// several groups can share the best or worst %.
type Insights struct {
	TopDegrees  []string `json:"top_degrees"`
	TopHalls    []string `json:"top_halls"` // "BITS · Hall 15"
	BottomHalls []string `json:"bottom_halls"`
	TopPct      *float64 `json:"top_hall_pct"`
	BottomPct   *float64 `json:"bottom_hall_pct"`
	DegreePct   *float64 `json:"top_degree_pct"`
	// Change is this period's % minus the previous period's, in points; nil
	// when either period has no marks.
	Change  *float64 `json:"change"`
	PrevPct *float64 `json:"prev_pct"`
}

// BuildInsights compares groups that have marks. A best/worst is only given
// when at least two groups have a % (one group has nothing to compare with).
func BuildInsights(a Analytics, prev Tally) Insights {
	var in Insights
	in.TopDegrees, in.DegreePct, _, _ = extremes(a.Degrees, func(g GroupTally) string { return g.Degree })
	hallName := func(g GroupTally) string {
		h := g.Hall
		if h == "" {
			h = "No hall"
		}
		return g.Degree + " · " + h
	}
	in.TopHalls, in.TopPct, in.BottomHalls, in.BottomPct = extremes(a.Halls, hallName)
	in.PrevPct = prev.Pct
	if a.Total.Pct != nil && prev.Pct != nil {
		v := math.Round((*a.Total.Pct-*prev.Pct)*100) / 100
		in.Change = &v
	}
	return in
}

func extremes(gs []GroupTally, name func(GroupTally) string) (top []string, topPct *float64, bottom []string, bottomPct *float64) {
	var withPct []GroupTally
	for _, g := range gs {
		if g.Pct != nil {
			withPct = append(withPct, g)
		}
	}
	if len(withPct) < 2 {
		return []string{}, nil, []string{}, nil
	}
	hi, lo := *withPct[0].Pct, *withPct[0].Pct
	for _, g := range withPct {
		hi, lo = math.Max(hi, *g.Pct), math.Min(lo, *g.Pct)
	}
	if hi == lo { // all the same: no best or worst
		return []string{}, nil, []string{}, nil
	}
	top, bottom = []string{}, []string{}
	for _, g := range withPct {
		if *g.Pct == hi {
			top = append(top, name(g))
		}
		if *g.Pct == lo {
			bottom = append(bottom, name(g))
		}
	}
	return top, &hi, bottom, &lo
}

// PresetRange is a named period ending today (IST): "today", "last7" (today
// and the six days before) or "lastmonth" (the previous calendar month).
func PresetRange(name string, today time.Time) (from, to time.Time, ok bool) {
	switch name {
	case "today":
		return today, today, true
	case "last7":
		return today.AddDate(0, 0, -6), today, true
	case "lastmonth":
		first := time.Date(today.Year(), today.Month(), 1, 0, 0, 0, 0, time.UTC)
		return first.AddDate(0, -1, 0), first.AddDate(0, 0, -1), true
	}
	return from, to, false
}

// ComparePeriod is what a period is compared with: the calendar month before
// for "lastmonth", otherwise the same number of days just before.
func ComparePeriod(period string, from, to time.Time) (time.Time, time.Time) {
	if period == "lastmonth" {
		f, t, _ := PresetRange("lastmonth", from)
		return f, t
	}
	return PreviousPeriod(from, to)
}

// MaxLookBack is how far PreviousWorkingDay searches.
const MaxLookBack = 14

// PreviousWorkingDay is the latest working day for the selected students
// before d, within MaxLookBack days, so a single day is compared with the
// last day that had class (not a Sunday or holiday).
func PreviousWorkingDay(students []AnalyticsStudent, d time.Time, cal Calendar, terms []Term, today time.Time) (time.Time, bool) {
	for k := 1; k <= MaxLookBack; k++ {
		day := d.AddDate(0, 0, -k)
		if Analyze(students, day, day, cal, terms, today).Total.WorkingDays > 0 {
			return day, true
		}
	}
	return time.Time{}, false
}

// StudentTally is one eligible student's counts over the period, for the
// drill-down lists behind the analytics cards.
type StudentTally struct {
	Index    int      `json:"-"` // position in the students slice given to StudentTallies
	Present  int      `json:"present"`
	Absent   int      `json:"absent"`
	Unmarked int      `json:"unmarked"`
	Pct      *float64 `json:"pct"`
}

// StudentTallies counts each selected, eligible student the same way Analyze
// does, keeping only those that match show: "all" (every eligible student),
// "present", "absent" or "unmarked" (at least one such day). Order follows
// the students slice.
func StudentTallies(students []AnalyticsStudent, from, to time.Time, cal Calendar, terms []Term, today time.Time, show string) []StudentTally {
	byIndex := map[int]*StudentTally{}
	eachStudentDay(students, from, to, cal, terms, today, func(i int, _ string, st Status) {
		t := byIndex[i]
		if t == nil {
			t = &StudentTally{Index: i}
			byIndex[i] = t
		}
		switch st {
		case Present:
			t.Present++
		case Absent:
			t.Absent++
		default:
			t.Unmarked++
		}
	})
	out := []StudentTally{}
	for i := range students {
		t := byIndex[i]
		if t == nil {
			continue
		}
		keep := show == "all" || (show == "present" && t.Present > 0) || (show == "absent" && t.Absent > 0) || (show == "unmarked" && t.Unmarked > 0)
		if keep {
			t.Pct = pct2(t.Present, t.Present+t.Absent)
			out = append(out, *t)
		}
	}
	return out
}

// ValidShow reports whether show is a StudentTallies list.
func ValidShow(show string) bool {
	return show == "all" || show == "present" || show == "absent" || show == "unmarked"
}
