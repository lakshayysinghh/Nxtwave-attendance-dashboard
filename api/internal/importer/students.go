// Package importer reads uploaded .xlsx and .csv sheets and validates their
// rows. It does no database work: callers compare rows with stored data and
// save them.
package importer

import (
	"bytes"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/xuri/excelize/v2"
)

// MaxFileSize is the upload limit from docs/PLAN.md.
const MaxFileSize = 10 << 20

// ReadTable returns the cells of a .csv file, or of the first sheet of an
// .xlsx file (Excel date cells come back as serial numbers).
func ReadTable(r io.Reader, fileName string) ([][]string, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxFileSize+1))
	if err != nil {
		return nil, err
	}
	if len(data) > MaxFileSize {
		return nil, errors.New("file is larger than 10 MB")
	}
	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".csv":
		cr := csv.NewReader(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf")))) // drop a UTF-8 BOM
		cr.FieldsPerRecord = -1
		cr.TrimLeadingSpace = true
		rows, err := cr.ReadAll()
		if err != nil {
			return nil, fmt.Errorf("could not read the CSV file: %w", err)
		}
		return rows, nil
	case ".xlsx":
		f, err := excelize.OpenReader(bytes.NewReader(data))
		if err != nil {
			return nil, errors.New("could not open the Excel file; save it as .xlsx and try again")
		}
		defer f.Close()
		sheets := f.GetSheetList()
		if len(sheets) == 0 {
			return nil, errors.New("the Excel file has no sheets")
		}
		return f.GetRows(sheets[0], excelize.Options{RawCellValue: true})
	default:
		return nil, errors.New("upload a .xlsx or .csv file")
	}
}

// Student columns, keyed by normalised header. Aliases follow docs/PLAN.md.
const (
	colNiatID  = "niat_id"
	colName    = "name"
	colDegree  = "degree"
	colSection = "section"
	colLevel   = "level"
	colHallNo  = "hall_no"
	colPOC     = "poc"
	colJoined  = "joined_on"
)

var studentHeaders = map[string]string{
	"niatid":             colNiatID,
	"studentfullname":    colName,
	"name":               colName,
	"degree":             colDegree,
	"section":            colSection,
	"level":              colLevel,
	"hallno":             colHallNo,
	"instructorassigned": colPOC,
	"poc":                colPOC,
	"joinedon":           colJoined,
}

var requiredHeaders = []struct{ key, label string }{
	{colNiatID, "NIAT ID"}, {colName, "Student Full Name"}, {colDegree, "Degree"}, {colSection, "Section"},
}

// normaliseHeader ignores case, spaces, dots and underscores: "Hall No." == "hall no".
func normaliseHeader(h string) string {
	return strings.NewReplacer(" ", "", ".", "", "_", "", " ", "").Replace(strings.ToLower(strings.TrimSpace(h)))
}

// StudentRow is one data row. Blank optional fields are empty strings / nil,
// meaning "keep the stored value".
type StudentRow struct {
	Row      int        `json:"row"` // 1-based sheet row number
	NiatID   string     `json:"niat_id"`
	Name     string     `json:"name"`
	Degree   string     `json:"degree"`
	Section  string     `json:"section"`
	Level    string     `json:"level"`
	HallNo   string     `json:"hall_no"`
	POC      string     `json:"poc"`
	JoinedOn *time.Time `json:"-"`
	Errors   []string   `json:"errors"`
	Warnings []string   `json:"warnings"`
}

func (r *StudentRow) fail(msg string) { r.Errors = append(r.Errors, msg) }

// ParseStudents maps the header row, reads every non-blank row and applies the
// checks that need no database: required fields, NIAT ID pattern, known
// degree, duplicate IDs in the file and a readable Joined On date. Unknown
// columns (such as attendance date columns) are ignored.
func ParseStudents(table [][]string, niatPattern *regexp.Regexp, degrees map[string]bool) ([]StudentRow, error) {
	if len(table) == 0 {
		return nil, errors.New("the file is empty")
	}
	cols := map[string]int{}
	for i, h := range table[0] {
		if key, ok := studentHeaders[normaliseHeader(h)]; ok {
			if _, dup := cols[key]; !dup {
				cols[key] = i
			}
		}
	}
	var missing []string
	for _, h := range requiredHeaders {
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
		return strings.Join(strings.Fields(row[i]), " ") // trim and collapse spaces
	}

	var out []StudentRow
	seen := map[string]int{}
	for i, raw := range table[1:] {
		r := StudentRow{
			Row:     i + 2,
			NiatID:  strings.ToUpper(cell(raw, colNiatID)),
			Name:    cell(raw, colName),
			Degree:  strings.ToUpper(cell(raw, colDegree)),
			Section: strings.ToUpper(cell(raw, colSection)),
			Level:   cell(raw, colLevel),
			HallNo:  cell(raw, colHallNo),
			POC:     cell(raw, colPOC),
		}
		if strings.TrimSpace(strings.Join(raw, "")) == "" {
			continue // blank line
		}

		switch {
		case r.NiatID == "":
			r.fail("NIAT ID is missing.")
		case !niatPattern.MatchString(r.NiatID):
			r.fail(fmt.Sprintf("NIAT ID %q does not match the expected format (like N24H01A0598).", r.NiatID))
		default:
			if first, dup := seen[r.NiatID]; dup {
				r.fail(fmt.Sprintf("Duplicate NIAT ID: already on row %d.", first))
			} else {
				seen[r.NiatID] = r.Row
			}
		}
		if r.Name == "" {
			r.fail("Student Full Name is missing.")
		}
		switch {
		case r.Degree == "":
			r.fail("Degree is missing.")
		case !degrees[r.Degree]:
			r.fail(fmt.Sprintf("Degree %q is not valid (use BITS or CDU).", r.Degree))
		}
		if r.Section == "" {
			r.fail("Section is missing.")
		}
		if v := cell(raw, colJoined); v != "" {
			if d, err := parseDate(v); err != nil {
				r.fail(fmt.Sprintf("Joined On %q is not a date (use 2026-08-19, 19-Aug-2026 or 19/08/2026).", v))
			} else {
				r.JoinedOn = &d
			}
		}
		out = append(out, r)
	}
	if len(out) == 0 {
		return nil, errors.New("the file has a header row but no student rows")
	}
	return out, nil
}

var dateLayouts = []string{"2006-01-02", "02-Jan-2006", "2-Jan-2006", "02/01/2006", "2/1/2006", "02-01-2006", "2 Jan 2006"}

// parseDate accepts the plan's date forms and Excel serial numbers.
func parseDate(s string) (time.Time, error) {
	for _, layout := range dateLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	if serial, err := strconv.ParseFloat(s, 64); err == nil && serial > 20000 && serial < 80000 {
		t, err := excelize.ExcelDateToTime(serial, false)
		if err == nil {
			y, m, d := t.Date()
			return time.Date(y, m, d, 0, 0, 0, 0, time.UTC), nil
		}
	}
	return time.Time{}, errors.New("not a date")
}
