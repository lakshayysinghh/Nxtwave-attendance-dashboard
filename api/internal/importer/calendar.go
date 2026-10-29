package importer

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

// CalendarRow is one row of a calendar sheet.
type CalendarRow struct {
	Row       int       `json:"row"`
	Date      time.Time `json:"-"`
	DateText  string    `json:"date"` // YYYY-MM-DD when valid, else the cell as written
	DayType   string    `json:"day_type"`
	AppliesTo string    `json:"applies_to"` // "ALL" or an upper-case degree code
	Label     string    `json:"label"`
	Counts    bool      `json:"counts"`
	Errors    []string  `json:"errors"`
	Warnings  []string  `json:"warnings"`
}

var calendarHeaders = map[string]string{
	"date": "date", "daytype": "day_type", "type": "day_type", "appliesto": "applies_to",
	"degree": "applies_to", "label": "label", "counts": "counts",
}

var dayTypes = map[string]bool{"working": true, "holiday": true, "exam": true, "event": true}

var yesNo = map[string]bool{"yes": true, "y": true, "true": true, "1": true, "no": false, "n": false, "false": false, "0": false}

// ParseCalendar reads the calendar template from docs/PLAN.md: Date, Day
// Type, Applies To, Label and optional Counts. Degree codes are checked by
// the caller against the degrees table; "All" becomes "ALL".
//
// Counts only matters for events (default Yes). Working days always count
// and holidays and exams never do, so a contradicting Counts value there is
// ignored with a warning.
func ParseCalendar(table [][]string, degrees map[string]bool) ([]CalendarRow, error) {
	if len(table) == 0 {
		return nil, errors.New("the file is empty")
	}
	cols := map[string]int{}
	for i, h := range table[0] {
		if key, ok := calendarHeaders[normaliseHeader(h)]; ok {
			if _, dup := cols[key]; !dup {
				cols[key] = i
			}
		}
	}
	var missing []string
	for _, h := range []struct{ key, label string }{{"date", "Date"}, {"day_type", "Day Type"}, {"applies_to", "Applies To"}} {
		if _, ok := cols[h.key]; !ok {
			missing = append(missing, h.label)
		}
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("missing column(s): %s. The first row must be the header row", strings.Join(missing, ", "))
	}
	cell := func(row []string, key string) string {
		i, ok := cols[key]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.Join(strings.Fields(row[i]), " ")
	}

	var out []CalendarRow
	seen := map[string]int{}
	for i, raw := range table[1:] {
		if strings.TrimSpace(strings.Join(raw, "")) == "" {
			continue
		}
		r := CalendarRow{Row: i + 2, Label: cell(raw, "label"), Errors: []string{}, Warnings: []string{}}
		fail := func(msg string) { r.Errors = append(r.Errors, msg) }

		dateText := cell(raw, "date")
		r.DateText = dateText
		switch d, err := parseDate(dateText); {
		case dateText == "":
			fail("Date is missing.")
		case err != nil:
			fail(fmt.Sprintf("Date %q is not readable (use 2026-08-19, 19-Aug-2026 or 19/08/2026).", dateText))
		default:
			r.Date, r.DateText = d, d.Format(time.DateOnly)
		}

		r.DayType = strings.ToLower(cell(raw, "day_type"))
		if r.DayType == "" {
			fail("Day Type is missing.")
		} else if !dayTypes[r.DayType] {
			fail(fmt.Sprintf("Day Type %q is not valid (use Working, Holiday, Exam or Event).", cell(raw, "day_type")))
		}

		applies := strings.ToUpper(cell(raw, "applies_to"))
		switch {
		case applies == "":
			fail("Applies To is missing (use All, BITS or CDU).")
		case applies == "ALL" || degrees[applies]:
			r.AppliesTo = applies
		default:
			fail(fmt.Sprintf("Applies To %q is not valid (use All, BITS or CDU).", cell(raw, "applies_to")))
		}

		if len(r.Label) > 100 {
			fail("Label is longer than 100 characters.")
		}

		countsText := strings.ToLower(cell(raw, "counts"))
		given, countsValue := false, false
		if countsText != "" {
			v, ok := yesNo[countsText]
			if !ok {
				fail(fmt.Sprintf("Counts %q is not valid (use Yes or No, or leave it blank).", cell(raw, "counts")))
			}
			given, countsValue = ok, v
		}
		switch r.DayType {
		case "working":
			r.Counts = true
		case "event":
			r.Counts = !given || countsValue
		}
		if given && r.DayType != "event" && countsValue != r.Counts {
			r.Warnings = append(r.Warnings, fmt.Sprintf("Counts is ignored for %s days.", r.DayType))
		}

		if len(r.Errors) == 0 {
			key := r.DateText + "|" + r.AppliesTo
			if first, dup := seen[key]; dup {
				fail(fmt.Sprintf("Duplicate entry for %s (%s): already on row %d.", r.DateText, r.AppliesTo, first))
			} else {
				seen[key] = r.Row
			}
		}
		out = append(out, r)
	}
	if len(out) == 0 {
		return nil, errors.New("the file has a header row but no calendar rows")
	}
	return out, nil
}
