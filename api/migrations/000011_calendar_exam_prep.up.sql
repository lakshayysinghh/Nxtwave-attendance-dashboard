-- A new calendar day type: exam preparation leave. Like holiday and exam it
-- never counts toward attendance.
ALTER TABLE calendar_days DROP CONSTRAINT calendar_days_day_type_check;
ALTER TABLE calendar_days ADD CONSTRAINT calendar_days_day_type_check
    CHECK (day_type IN ('working', 'holiday', 'exam', 'exam_prep', 'event'));
