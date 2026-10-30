// Package stats is the only home of business rules: day resolution, one
// attendance mark per day, and percentages. It is pure Go with no HTTP or
// database access, so every rule is covered by table-driven tests.
//
// Dates are calendar dates in Asia/Kolkata, represented as time.Time at
// midnight UTC (the form pgx returns for DATE columns).
package stats

import (
	"math"
	"time"
)

// IST is Asia/Kolkata. It has had no daylight saving since 1945, so a fixed
// offset is exact and needs no tz database.
var IST = time.FixedZone("IST", 5*60*60+30*60)

func Date(y int, m time.Month, d int) time.Time {
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// TodayIST is the current calendar date in India.
func TodayIST(now time.Time) time.Time {
	y, m, d := now.In(IST).Date()
	return Date(y, m, d)
}

func DateKey(d time.Time) string { return d.Format(time.DateOnly) }

// Kind is what the calendar says about a date.
type Kind string

const (
	KindWorking Kind = "working"
	KindHoliday Kind = "holiday"
	KindExam    Kind = "exam"
	KindEvent   Kind = "event"
	KindSunday  Kind = "sunday"
)

// Exclusion is why an otherwise counted date does not count for a student.
type Exclusion string

const (
	NotExcluded Exclusion = ""
	OutsideTerm Exclusion = "outside_term"
	BeforeJoin  Exclusion = "before_join"
	AfterDrop   Exclusion = "after_drop"
	Future      Exclusion = "future"
)

// CalendarEntry is one row of calendar_days. AppliesTo is "ALL" or a degree code.
type CalendarEntry struct {
	Date      time.Time
	AppliesTo string
	DayType   Kind
	Counts    bool
	Label     string
}

// Calendar indexes entries by date and AppliesTo.
type Calendar struct {
	byDate map[string]map[string]CalendarEntry
}

func NewCalendar(entries []CalendarEntry) Calendar {
	c := Calendar{byDate: map[string]map[string]CalendarEntry{}}
	for _, e := range entries {
		k := DateKey(e.Date)
		if c.byDate[k] == nil {
			c.byDate[k] = map[string]CalendarEntry{}
		}
		c.byDate[k][e.AppliesTo] = e
	}
	return c
}

type Term struct {
	ID        int64
	Name      string
	Start     time.Time
	End       time.Time
	IsCurrent bool
}

// Contains reports whether d falls in the term, both ends included.
func (t Term) Contains(d time.Time) bool {
	return !d.Before(t.Start) && !d.After(t.End)
}

// Student holds the fields the rules need.
type Student struct {
	Degree    string
	JoinedOn  *time.Time // nil: counts from the term start
	DroppedOn *time.Time // nil: still active; otherwise counts up to and including this date
}

// Day is a date resolved for one student.
type Day struct {
	Date      time.Time
	Kind      Kind
	Label     string
	Excluded  Exclusion
	Counted   bool // true only when the day counts and is not excluded
	dayCounts bool
}

// ResolveDay applies the day-resolution order from docs/PLAN.md:
//  1. outside every term, before joining, after dropping, or in the future: not counted;
//  2. a calendar entry for the student's degree;
//  3. a calendar entry for ALL;
//  4. Sunday: holiday;
//  5. otherwise: working.
//
// The calendar kind and label are filled in even for excluded days, so a
// future holiday still shows its label.
func ResolveDay(d time.Time, s Student, cal Calendar, terms []Term, today time.Time) Day {
	day := Day{Date: d}
	entries := cal.byDate[DateKey(d)]
	if e, ok := entries[s.Degree]; ok {
		day.Kind, day.Label, day.dayCounts = e.DayType, e.Label, entryCounts(e)
	} else if e, ok := entries["ALL"]; ok {
		day.Kind, day.Label, day.dayCounts = e.DayType, e.Label, entryCounts(e)
	} else if d.Weekday() == time.Sunday {
		day.Kind, day.dayCounts = KindSunday, false
	} else {
		day.Kind, day.dayCounts = KindWorking, true
	}

	switch {
	case d.After(today):
		day.Excluded = Future
	case !inAnyTerm(d, terms):
		day.Excluded = OutsideTerm
	case s.JoinedOn != nil && d.Before(*s.JoinedOn):
		day.Excluded = BeforeJoin
	case s.DroppedOn != nil && d.After(*s.DroppedOn):
		day.Excluded = AfterDrop
	}
	day.Counted = day.dayCounts && day.Excluded == NotExcluded
	return day
}

// entryCounts: working always counts, holiday and exam never do, an event
// follows its own Counts flag.
func entryCounts(e CalendarEntry) bool {
	switch e.DayType {
	case KindWorking:
		return true
	case KindEvent:
		return e.Counts
	default:
		return false
	}
}

func inAnyTerm(d time.Time, terms []Term) bool {
	for _, t := range terms {
		if t.Contains(d) {
			return true
		}
	}
	return false
}

// Status is one day's mark.
type Status uint8

const (
	NotMarked Status = iota
	Present
	Absent
)

// Marks maps DateKey to a student's mark for that day.
type Marks map[string]Status

// Summary counts a student's counted days over a period.
type Summary struct {
	CountedDays int      `json:"counted_days"`
	Present     int      `json:"days_attended"`
	Absent      int      `json:"days_absent"`
	NotMarked   int      `json:"not_marked_days"`
	Pct         *float64 `json:"pct"` // nil when nothing is marked ("–")
	Band        Band     `json:"band"`
}

func (s *Summary) add(st Status) {
	s.CountedDays++
	switch st {
	case Present:
		s.Present++
	case Absent:
		s.Absent++
	default:
		s.NotMarked++
	}
}

// finish sets the % = present ÷ (present + absent) × 100, to one decimal.
// Unmarked days are left out, so a blank never counts as absent.
func (s *Summary) finish() {
	if marked := s.Present + s.Absent; marked > 0 {
		p := math.Round(float64(s.Present)*1000/float64(marked)) / 10
		s.Pct = &p
	}
	s.Band = BandOf(s.Pct)
}

// Summarize counts the student's counted days from..to inclusive.
// Marks on days that do not count are ignored.
func Summarize(s Student, from, to time.Time, cal Calendar, terms []Term, marks Marks, today time.Time) Summary {
	var sum Summary
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		if ResolveDay(d, s, cal, terms, today).Counted {
			sum.add(marks[DateKey(d)])
		}
	}
	sum.finish()
	return sum
}

// MonthSummary is a Summary for one calendar month, clipped to the term.
type MonthSummary struct {
	Month string `json:"month"` // YYYY-MM
	Summary
}

// Months returns one summary per month of the term, up to today's month.
func Months(s Student, term Term, cal Calendar, terms []Term, marks Marks, today time.Time) []MonthSummary {
	var out []MonthSummary
	for m := Date(term.Start.Year(), term.Start.Month(), 1); !m.After(term.End) && !m.After(today); m = m.AddDate(0, 1, 0) {
		from, to := m, m.AddDate(0, 1, -1)
		if from.Before(term.Start) {
			from = term.Start
		}
		if to.After(term.End) {
			to = term.End
		}
		out = append(out, MonthSummary{Month: m.Format("2006-01"), Summary: Summarize(s, from, to, cal, terms, marks, today)})
	}
	return out
}

// DayDetail is one calendar day for a student, with its mark (NotMarked on
// days that do not count).
type DayDetail struct {
	Day
	Status Status
}

// MonthDays resolves every day of month m (any date in it) for the student.
func MonthDays(s Student, m time.Time, cal Calendar, terms []Term, marks Marks, today time.Time) []DayDetail {
	first := Date(m.Year(), m.Month(), 1)
	var out []DayDetail
	for d := first; d.Month() == first.Month(); d = d.AddDate(0, 0, 1) {
		day := ResolveDay(d, s, cal, terms, today)
		det := DayDetail{Day: day}
		if day.Counted {
			det.Status = marks[DateKey(d)]
		}
		out = append(out, det)
	}
	return out
}

// PreviousCountedDay returns the last day before d that counts for s,
// looking back at most 31 days; ok is false when there is none. The import
// preview uses it to suggest the date of an unreadable date header.
func PreviousCountedDay(d time.Time, s Student, cal Calendar, terms []Term, today time.Time) (time.Time, bool) {
	for i := 1; i <= 31; i++ {
		prev := d.AddDate(0, 0, -i)
		if ResolveDay(prev, s, cal, terms, today).Counted {
			return prev, true
		}
	}
	return time.Time{}, false
}

// CurrentTerm returns the term flagged current, else the term containing
// today, else the latest term that has started; ok is false with no terms.
func CurrentTerm(terms []Term, today time.Time) (Term, bool) {
	for _, t := range terms {
		if t.IsCurrent {
			return t, true
		}
	}
	for _, t := range terms {
		if t.Contains(today) {
			return t, true
		}
	}
	var best Term
	found := false
	for _, t := range terms {
		if !t.Start.After(today) && (!found || t.Start.After(best.Start)) {
			best, found = t, true
		}
	}
	return best, found
}

// Overview summarises a group: the group % is the average of its students'
// percentages (students with nothing marked are left out), per docs/PLAN.md.
type Overview struct {
	Students       int          `json:"students"`
	AveragePct     *float64     `json:"average_pct"`
	BelowThreshold int          `json:"below_threshold"`
	Threshold      float64      `json:"threshold"`
	Bands          map[Band]int `json:"bands"` // students per band, including "none"
}

func Summarise(summaries []Summary, threshold float64) Overview {
	o := Overview{Students: len(summaries), Threshold: threshold, Bands: map[Band]int{BandLow: 0, BandMid: 0, BandHigh: 0, BandNone: 0}}
	var total float64
	n := 0
	for _, s := range summaries {
		o.Bands[BandOf(s.Pct)]++
		if s.Pct == nil {
			continue
		}
		total += *s.Pct
		n++
		if *s.Pct < threshold {
			o.BelowThreshold++
		}
	}
	if n > 0 {
		avg := math.Round(total*10/float64(n)) / 10
		o.AveragePct = &avg
	}
	return o
}

// Band groups a percentage by the default edges: below 60, 60 to below 75,
// 75 and above. Exactly 60.0 is mid and exactly 75.0 is high.
type Band string

const (
	BandLow  Band = "below_60"
	BandMid  Band = "60_to_75"
	BandHigh Band = "75_plus"
	BandNone Band = "none" // nothing marked yet
)

const (
	BandEdgeMid  = 60.0
	BandEdgeHigh = 75.0
)

func BandOf(pct *float64) Band {
	switch {
	case pct == nil:
		return BandNone
	case *pct < BandEdgeMid:
		return BandLow
	case *pct < BandEdgeHigh:
		return BandMid
	default:
		return BandHigh
	}
}

// PlacementThreshold is the attendance percentage needed for placement eligibility.
const PlacementThreshold = 95

// PlacementMonth is one month's standing against the placement threshold.
type PlacementMonth struct {
	Month string   `json:"month"` // YYYY-MM
	Pct   *float64 `json:"pct"`   // nil when nothing is marked that month
	Below bool     `json:"below"`
}

// Placement is a student's standing against PlacementThreshold, for the
// term and for each month so far.
type Placement struct {
	Threshold  int              `json:"threshold"`
	Pct        *float64         `json:"pct"`
	Below      bool             `json:"below"`
	DaysNeeded int              `json:"days_needed"` // present days in a row needed to reach the threshold
	Months     []PlacementMonth `json:"months"`
}

// PlacementStatus compares the term summary and each month with
// PlacementThreshold. The comparison uses the exact counts, not the rounded
// %, so 94.96% is still below 95%. Periods with nothing marked are never below.
func PlacementStatus(term Summary, months []MonthSummary) Placement {
	p := Placement{Threshold: PlacementThreshold, Pct: term.Pct, Below: belowPlacement(term), Months: []PlacementMonth{}}
	if p.Below {
		// Smallest n with (P+n)·100 >= T·(P+A+n).
		gap := PlacementThreshold*(term.Present+term.Absent) - 100*term.Present
		p.DaysNeeded = (gap + (100 - PlacementThreshold) - 1) / (100 - PlacementThreshold)
	}
	for _, m := range months {
		p.Months = append(p.Months, PlacementMonth{Month: m.Month, Pct: m.Pct, Below: belowPlacement(m.Summary)})
	}
	return p
}

func belowPlacement(s Summary) bool {
	marked := s.Present + s.Absent
	return marked > 0 && 100*s.Present < PlacementThreshold*marked
}
