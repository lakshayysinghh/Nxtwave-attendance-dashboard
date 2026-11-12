-- Exam preparation days become holidays (both never count), keeping their labels.
UPDATE calendar_days SET day_type = 'holiday' WHERE day_type = 'exam_prep';
ALTER TABLE calendar_days DROP CONSTRAINT calendar_days_day_type_check;
ALTER TABLE calendar_days ADD CONSTRAINT calendar_days_day_type_check
    CHECK (day_type IN ('working', 'holiday', 'exam', 'event'));
