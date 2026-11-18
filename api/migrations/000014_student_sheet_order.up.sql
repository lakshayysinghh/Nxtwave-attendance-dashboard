-- The student's row in the last student import file it appeared in, so the
-- daily export lists students in the same order as the team's own sheet.
-- NULL for students added by hand or never imported; they go last.
ALTER TABLE students ADD COLUMN sheet_order integer;
CREATE INDEX students_degree_sheet_order ON students (degree_code, sheet_order);
