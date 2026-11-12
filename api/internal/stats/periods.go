package stats

import (
	"sort"
	"time"
)

// Category says why a mark was set. A regular mark has no category.
type Category string

const (
	CategoryNone                Category = ""
	CategoryInternship          Category = "INTERNSHIP"           // always Present
	CategoryRegistrationPending Category = "REGISTRATION_PENDING" // always Absent
)

// CategoryStatus is the mark a category always carries.
func CategoryStatus(c Category) Status {
	switch c {
	case CategoryInternship:
		return Present
	case CategoryRegistrationPending:
		return Absent
	}
	return NotMarked
}

// SheetCell is one date cell of one student in an imported sheet. Marked is
// true for a recognised value (Present, Absent or a category); a blank or an
// unsupported value (like #REF!) is not marked.
type SheetCell struct {
	Date     time.Time
	Category Category
	Marked   bool
}

// Run is a stretch of consecutive date columns holding the same category.
// CompletedOn is set for a registration-pending run when the next column
// holds another recognised mark: registration was done by that day.
type Run struct {
	Category    Category
	Start, End  time.Time
	CompletedOn *time.Time
}

// CategoryRuns finds the category runs in one student's cells. Any cell that
// is not the same category ends a run: a blank or unsupported cell ends it
// without recording completion, since nothing is known about that day.
// Dates are never invented: every start, end and completion is a cell's date.
func CategoryRuns(cells []SheetCell) []Run {
	sorted := append([]SheetCell(nil), cells...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Date.Before(sorted[j].Date) })

	var runs []Run
	var cur *Run
	for _, c := range sorted {
		if cur != nil && c.Marked && c.Category == cur.Category {
			cur.End = c.Date
			continue
		}
		if cur != nil {
			if cur.Category == CategoryRegistrationPending && c.Marked {
				d := c.Date
				cur.CompletedOn = &d
			}
			runs = append(runs, *cur)
			cur = nil
		}
		if c.Marked && c.Category != CategoryNone {
			cur = &Run{Category: c.Category, Start: c.Date, End: c.Date}
		}
	}
	if cur != nil {
		runs = append(runs, *cur)
	}
	return runs
}

// Period is a stored internship or registration-pending period.
type Period struct {
	ID          int64
	Kind        Category
	Start, End  time.Time
	CompletedOn *time.Time
}

// RunPlan is what to store for one imported run: extend period ExtendID
// (0: create a new one) to Start..End, and cancel MergeIDs, which the run
// joined into the extended period.
type RunPlan struct {
	ExtendID    int64
	Start, End  time.Time
	CompletedOn *time.Time
	MergeIDs    []int64
}

// PlanRun joins an imported run with the student's stored periods of the
// same kind (not cancelled). A period joins when it overlaps the run or
// touches it with no counted working day in between (so a sheet that ends
// on Saturday and the next that starts on Monday continue one period). A
// registration period that was already completed is not continued, only
// joined when it overlaps. Re-importing the same sheet changes nothing.
func PlanRun(run Run, existing []Period, s Student, cal Calendar) RunPlan {
	plan := RunPlan{Start: run.Start, End: run.End, CompletedOn: run.CompletedOn}
	var joined []Period
	for _, p := range existing {
		if p.Kind != run.Category {
			continue
		}
		overlaps := !p.Start.After(run.End) && !p.End.Before(run.Start)
		continues := p.End.Before(run.Start) && noWorkingDayBetween(p.End, run.Start, s, cal) &&
			(p.Kind != CategoryRegistrationPending || p.CompletedOn == nil)
		precedes := run.End.Before(p.Start) && noWorkingDayBetween(run.End, p.Start, s, cal)
		if overlaps || continues || precedes {
			joined = append(joined, p)
		}
	}
	if len(joined) == 0 {
		return plan
	}
	sort.Slice(joined, func(i, j int) bool { return joined[i].Start.Before(joined[j].Start) })
	plan.ExtendID = joined[0].ID
	lastEnd := run.End
	for i, p := range joined {
		if i > 0 {
			plan.MergeIDs = append(plan.MergeIDs, p.ID)
		}
		if p.Start.Before(plan.Start) {
			plan.Start = p.Start
		}
		if p.End.After(plan.End) {
			plan.End = p.End
		}
		// The completion belongs to whichever part ends last.
		if p.End.After(lastEnd) {
			lastEnd, plan.CompletedOn = p.End, p.CompletedOn
		}
	}
	if plan.CompletedOn != nil && !plan.CompletedOn.After(plan.End) {
		plan.CompletedOn = nil
	}
	return plan
}

// noWorkingDayBetween reports whether no day strictly between a and b is a
// working day for the student's degree by the calendar.
func noWorkingDayBetween(a, b time.Time, s Student, cal Calendar) bool {
	for d := a.AddDate(0, 0, 1); d.Before(b); d = d.AddDate(0, 0, 1) {
		if ResolveDay(d, s, cal, nil, d).dayCounts {
			return false
		}
	}
	return true
}

// DatesBetween is every date from..to inclusive. An internship marks every
// one of them Present; days that do not count (Sundays, holidays, outside a
// term) are ignored by the percentage as for any other mark.
func DatesBetween(from, to time.Time) []time.Time {
	var out []time.Time
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		out = append(out, d)
	}
	return out
}

// IsInternshipConflict reports whether an existing mark differs from what
// an internship would set (Present, INTERNSHIP). The admin decides whether
// such marks are overwritten.
func IsInternshipConflict(st Status, c Category) bool {
	return st != NotMarked && (st != Present || c != CategoryInternship)
}

// DateRange is a closed range of dates.
type DateRange struct{ From, To time.Time }

// RemovedRanges is the part of old that cur no longer covers: up to two
// ranges, one before and one after cur.
func RemovedRanges(old, cur DateRange) []DateRange {
	var out []DateRange
	if old.From.Before(cur.From) {
		to := cur.From.AddDate(0, 0, -1)
		if old.To.Before(to) {
			to = old.To
		}
		out = append(out, DateRange{old.From, to})
	}
	if old.To.After(cur.To) {
		from := cur.To.AddDate(0, 0, 1)
		if old.From.After(from) {
			from = old.From
		}
		out = append(out, DateRange{from, old.To})
	}
	return out
}

// PeriodDays counts a period's calendar days and its attendance days: the
// days in it that count for the student up to today.
func PeriodDays(s Student, from, to time.Time, cal Calendar, terms []Term, today time.Time) (calendarDays, attendanceDays int) {
	for d := from; !d.After(to); d = d.AddDate(0, 0, 1) {
		calendarDays++
		if ResolveDay(d, s, cal, terms, today).Counted {
			attendanceDays++
		}
	}
	return calendarDays, attendanceDays
}

// PeriodState is a period's standing on a given day.
type PeriodState string

const (
	StateUpcoming  PeriodState = "upcoming"  // internship that has not started
	StateActive    PeriodState = "active"    // internship running today
	StateEnded     PeriodState = "ended"     // internship that is over
	StatePending   PeriodState = "pending"   // registration not completed yet
	StateCompleted PeriodState = "completed" // registration completed
	StateCancelled PeriodState = "cancelled"
)

func StateOf(p Period, cancelled bool, today time.Time) PeriodState {
	switch {
	case cancelled:
		return StateCancelled
	case p.Kind == CategoryRegistrationPending && p.CompletedOn != nil:
		return StateCompleted
	case p.Kind == CategoryRegistrationPending:
		return StatePending
	case today.Before(p.Start):
		return StateUpcoming
	case today.After(p.End):
		return StateEnded
	default:
		return StateActive
	}
}
