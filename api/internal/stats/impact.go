package stats

import (
	"sort"
	"time"
)

// DayImpact is how one date changes for one degree's students when the
// calendar changes: what it was, what it becomes.
type DayImpact struct {
	Date   time.Time
	Degree string
	Before Day
	After  Day
}

// CountingChanged reports whether the date moves in or out of the counted
// days (so saved marks start or stop counting).
func (d DayImpact) CountingChanged() bool { return d.Before.Counted != d.After.Counted }

// CalendarImpact resolves every date for every degree with the calendar
// before and after a change, and returns the pairs where the day type,
// label or counting differ. Student join and drop dates are not applied, so
// this is what may change; a student's own dates can still exclude a day.
// today is the IST date: a future date is reported but does not count yet.
func CalendarImpact(dates []time.Time, degrees []string, before, after Calendar, terms []Term, today time.Time) []DayImpact {
	seen := map[string]bool{}
	var ds []time.Time
	for _, d := range dates {
		if k := DateKey(d); !seen[k] {
			seen[k] = true
			ds = append(ds, d)
		}
	}
	sort.Slice(ds, func(i, j int) bool { return ds[i].Before(ds[j]) })
	degs := append([]string(nil), degrees...)
	sort.Strings(degs)

	var out []DayImpact
	for _, d := range ds {
		for _, g := range degs {
			s := Student{Degree: g}
			b, a := ResolveDay(d, s, before, terms, today), ResolveDay(d, s, after, terms, today)
			if b.Kind != a.Kind || b.Label != a.Label || b.Counted != a.Counted || b.dayCounts != a.dayCounts {
				out = append(out, DayImpact{Date: d, Degree: g, Before: b, After: a})
			}
		}
	}
	return out
}

// Without returns the entries left after removing those whose (date,
// AppliesTo) is in remove.
func Without(entries []CalendarEntry, remove []CalendarEntry) []CalendarEntry {
	gone := map[string]bool{}
	for _, e := range remove {
		gone[DateKey(e.Date)+"|"+e.AppliesTo] = true
	}
	out := make([]CalendarEntry, 0, len(entries))
	for _, e := range entries {
		if !gone[DateKey(e.Date)+"|"+e.AppliesTo] {
			out = append(out, e)
		}
	}
	return out
}

// DayCounts reports whether the calendar makes the day count, ignoring term,
// join, drop and future (the "counts toward attendance" of a calendar day).
func (d Day) DayCounts() bool { return d.dayCounts }
