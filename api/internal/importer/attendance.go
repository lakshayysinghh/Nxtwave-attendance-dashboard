package importer

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
)

// DateColumn is a column whose header is a date.
type DateColumn struct {
	Index  int       `json:"-"`
	Header string    `json:"header"`
	Date   time.Time `json:"-"`
}

// AttendanceCell is one non-blank mark: "P" or "A" for the whole day.
type AttendanceCell struct {
	Date   time.Time
	Status string
}

// AttendanceRow is one student row. Blank cells are left out (no change).
type AttendanceRow struct {
	Row      int
	NiatID   string
	FileName string // the name column, if the sheet has one
	Cells    []AttendanceCell
	Blank    int // blank cells: no change
	Errors   []string
}

// AttendanceSheet is a parsed attendance upload.
type AttendanceSheet struct {
	Dates        []DateColumn
	HeaderErrors []string // unreadable or repeated date headers; those columns are ignored
	Rows         []AttendanceRow
}

var markValues = map[string]string{"present": "P", "p": "P", "1": "P", "absent": "A", "a": "A", "0": "A"}

// ParseAttendance reads the wide format from docs/PLAN.md: NIAT ID, then one
// column per date. Headers without digits (Name, Section, ...) are ignored;
// a header with digits that is not a readable date is reported. Cell values
// Present/Absent/P/A/1/0 are accepted in any case; blank means no change.
// Date columns after today are reported and ignored.
func ParseAttendance(table [][]string, today time.Time) (AttendanceSheet, error) {
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
		case norm == "studentfullname" || norm == "name":
			if nameCol < 0 {
				nameCol = i
			}
		case strings.IndexFunc(h, unicode.IsDigit) >= 0:
			d, err := parseDate(strings.TrimSpace(h))
			if err != nil {
				sheet.HeaderErrors = append(sheet.HeaderErrors,
					fmt.Sprintf("Column %q is not a readable date (use 19-Aug-2026, 19/08/2026 or 2026-08-19); it was ignored.", h))
				continue
			}
			if d.After(today) {
				sheet.HeaderErrors = append(sheet.HeaderErrors, fmt.Sprintf("Column %q is in the future; it was ignored.", h))
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
		}
	}
	if idCol < 0 {
		return sheet, errors.New("missing column: NIAT ID. The first row must be the header row")
	}
	if len(sheet.Dates) == 0 && len(sheet.HeaderErrors) == 0 {
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
			status, ok := markValues[strings.ToLower(v)]
			if !ok {
				r.Errors = append(r.Errors, fmt.Sprintf("%s: %q is not a valid mark (use Present, Absent, P, A, 1 or 0).", dc.Header, v))
				continue
			}
			r.Cells = append(r.Cells, AttendanceCell{Date: dc.Date, Status: status})
		}
		sheet.Rows = append(sheet.Rows, r)
	}
	if len(sheet.Rows) == 0 {
		return sheet, errors.New("the file has a header row but no student rows")
	}
	return sheet, nil
}
