package importer

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
)

type DateColumn struct {
	Index  int       `json:"-"`
	Header string    `json:"header"`
	Date   time.Time `json:"-"`
}

// AttendanceCell is one recognised mark: "P" or "A" for the whole day, with
// the category the value names ("" for a plain Present or Absent).
type AttendanceCell struct {
	Date     time.Time
	Status   string
	Category string
	Mapped   bool   // the value was mapped by the admin (value map), not recognised
	Raw      string // the value as written, for mapped cells
}

// AttendanceRow is one student row. Blank cells are left out (no change).
type AttendanceRow struct {
	Row      int
	NiatID   string
	FileName string // the name column, if the sheet has one
	Cells    []AttendanceCell
	Blank    int      // blank cells: no change
	Skipped  []string // cells with a value that is not a mark: left not marked
	Errors   []string // only problems with the NIAT ID itself
}

// BadColumn is a header with digits that is not a readable date. Its cells
// are read only once the admin gives the column a date.
type BadColumn struct {
	Index  int    `json:"column"` // 0-based column index, as sent back in column dates
	Header string `json:"header"`
}

type AttendanceSheet struct {
	Dates          []DateColumn
	BadColumns     []BadColumn // unreadable date headers not yet given a date
	HeaderErrors   []string    // repeated dates; those columns are ignored
	HeaderWarnings []string    // future dates; those columns are ignored
	// IgnoredColumns are headers that are neither a date nor a known student
	// column; their cells are not read. Listed so nothing is dropped silently.
	IgnoredColumns []string
	// Unsupported counts each value that is not a mark and was not mapped,
	// by the value as written (trimmed). Those cells are skipped.
	Unsupported map[string]int
	Rows        []AttendanceRow
}

// Category values, as stored in attendance.category.
const (
	CategoryInternship          = "INTERNSHIP"
	CategoryRegistrationPending = "REGISTRATION_PENDING"
)

type markValue struct{ status, category string }

// markValues are the recognised cell values, by NormaliseValue.
var markValues = map[string]markValue{
	"present": {"P", ""}, "p": {"P", ""}, "1": {"P", ""},
	"absent": {"A", ""}, "a": {"A", ""}, "0": {"A", ""},
	"internship period":           {"P", CategoryInternship},
	"term 5 registration pending": {"A", CategoryRegistrationPending},
}

// NormaliseValue is how cell values are compared: trimmed, lower case,
// runs of spaces as one. "  Internship   PERIOD " == "internship period".
func NormaliseValue(v string) string { return strings.ToLower(strings.Join(strings.Fields(v), " ")) }

// ParseAttendance is ParseAttendanceWith without a value map.
func ParseAttendance(table [][]string, today time.Time, columnDates map[int]time.Time) (AttendanceSheet, error) {
	return ParseAttendanceWith(table, today, columnDates, nil)
}

// ParseAttendanceWith reads the wide format from docs/PLAN.md: NIAT ID, then
// one column per date. Known student columns (Name, Section, ...) are not
// read here; other headers without digits are listed in IgnoredColumns; a
// header with digits that is not a readable date is listed in BadColumns.
// Recognised cell values (any case and spacing): Present/P/1, Absent/A/0,
// "Internship Period" (Present, INTERNSHIP) and "Term 5 Registration
// Pending" (Absent, REGISTRATION_PENDING). Blank means no change. valueMap
// (by NormaliseValue, to "P" or "A") is the admin's mapping for other
// values; any value still unknown is skipped for that cell only, counted in
// Unsupported and listed in the row's Skipped, never guessed.
// Date columns after today are reported and ignored. columnDates gives a
// date to columns whose header is unreadable (by 0-based index); it may be nil.
func ParseAttendanceWith(table [][]string, today time.Time, columnDates map[int]time.Time, valueMap map[string]string) (AttendanceSheet, error) {
	var sheet AttendanceSheet
	if len(table) == 0 {
		return sheet, errors.New("the file is empty")
	}
	idCol, nameCol := -1, -1
	seenDates := map[string]string{}
	for i, h := range table[0] {
		norm := normaliseHeader(h)
		switch {
		case norm == "niatid":
			if idCol < 0 {
				idCol = i
			}
		case norm == "studentname" || norm == "studentfullname" || norm == "name":
			if nameCol < 0 {
				nameCol = i
			}
		case strings.IndexFunc(h, unicode.IsDigit) >= 0:
			d, err := parseDate(strings.TrimSpace(h))
			if err != nil {
				fixed, ok := columnDates[i]
				if !ok {
					sheet.BadColumns = append(sheet.BadColumns, BadColumn{Index: i, Header: strings.TrimSpace(h)})
					continue
				}
				d = fixed
			}
			if d.After(today) {
				sheet.HeaderWarnings = append(sheet.HeaderWarnings, fmt.Sprintf("Column %q is in the future; it was ignored.", h))
				continue
			}
			key := d.Format(time.DateOnly)
			if first, dup := seenDates[key]; dup {
				sheet.HeaderErrors = append(sheet.HeaderErrors,
					fmt.Sprintf("Column %q repeats the date in column %q; it was ignored.", h, first))
				continue
			}
			seenDates[key] = h
			sheet.Dates = append(sheet.Dates, DateColumn{Index: i, Header: strings.TrimSpace(h), Date: d})
		default:
			if _, known := studentHeaders[norm]; !known && norm != "" {
				sheet.IgnoredColumns = append(sheet.IgnoredColumns, strings.TrimSpace(h))
			}
		}
	}
	if idCol < 0 {
		return sheet, errors.New("missing column: NIAT ID. The first row must be the header row")
	}
	if len(sheet.Dates) == 0 && len(sheet.BadColumns) == 0 && len(sheet.HeaderErrors) == 0 && len(sheet.HeaderWarnings) == 0 {
		return sheet, errors.New("no date columns found; add one column per date, e.g. 19-Aug-2026")
	}

	get := func(row []string, i int) string {
		if i < 0 || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}
	seenIDs := map[string]int{}
	for i, raw := range table[1:] {
		if strings.TrimSpace(strings.Join(raw, "")) == "" {
			continue
		}
		r := AttendanceRow{Row: i + 2, NiatID: strings.ToUpper(get(raw, idCol)), FileName: get(raw, nameCol)}
		if r.NiatID == "" {
			r.Errors = append(r.Errors, "NIAT ID is missing.")
		} else {
			if first, dup := seenIDs[r.NiatID]; dup {
				r.Errors = append(r.Errors, fmt.Sprintf("Duplicate NIAT ID: already on row %d.", first))
			} else {
				seenIDs[r.NiatID] = r.Row
			}
		}
		for _, dc := range sheet.Dates {
			v := get(raw, dc.Index)
			if v == "" {
				r.Blank++
				continue
			}
			norm := NormaliseValue(v)
			if mv, ok := markValues[norm]; ok {
				r.Cells = append(r.Cells, AttendanceCell{Date: dc.Date, Status: mv.status, Category: mv.category})
				continue
			}
			if st := valueMap[norm]; st == "P" || st == "A" {
				r.Cells = append(r.Cells, AttendanceCell{Date: dc.Date, Status: st, Mapped: true, Raw: v})
				continue
			}
			if sheet.Unsupported == nil {
				sheet.Unsupported = map[string]int{}
			}
			sheet.Unsupported[v]++
			r.Skipped = append(r.Skipped, fmt.Sprintf("%s: %q is not a mark or a supported category; not saved. Map it or leave it out.", dc.Date.Format("2 Jan"), v))
		}
		sheet.Rows = append(sheet.Rows, r)
	}
	if len(sheet.Rows) == 0 {
		return sheet, errors.New("the file has a header row but no student rows")
	}
	return sheet, nil
}
