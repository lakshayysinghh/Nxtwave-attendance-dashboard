-- Core schema from docs/PLAN.md "Data model".
-- Calendar and attendance dates are plain DATE (Asia/Kolkata); timestamps are
-- only audit fields. No phone numbers are stored anywhere.

CREATE TABLE admins (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email      text        NOT NULL UNIQUE CHECK (email = lower(email) AND email <> ''),
    name       text        NOT NULL DEFAULT '',
    role       text        NOT NULL DEFAULT 'admin' CHECK (role IN ('owner', 'admin')),
    active     boolean     NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE degrees (
    code text PRIMARY KEY CHECK (code = upper(code) AND code <> 'ALL'),
    name text NOT NULL
);

CREATE TABLE terms (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text    NOT NULL,
    start_date date    NOT NULL,
    end_date   date    NOT NULL,
    is_current boolean NOT NULL DEFAULT false,
    CONSTRAINT terms_dates_ordered CHECK (end_date >= start_date),
    CONSTRAINT terms_no_overlap EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&)
);
-- At most one current term.
CREATE UNIQUE INDEX terms_one_current ON terms (is_current) WHERE is_current;

CREATE TABLE mentors (
    id   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL CHECK (btrim(name) <> ''),
    kind text NOT NULL CHECK (kind IN ('poc', 'coach'))
);
CREATE UNIQUE INDEX mentors_kind_name ON mentors (kind, lower(name));

CREATE TABLE students (
    niat_id     text        PRIMARY KEY CHECK (niat_id = upper(niat_id) AND niat_id <> ''),
    full_name   text        NOT NULL,
    degree_code text        NOT NULL REFERENCES degrees (code),
    section     text        NOT NULL,
    level       text,
    hall_no     text,
    poc_id      bigint      REFERENCES mentors (id) ON DELETE SET NULL,
    coach_id    bigint      REFERENCES mentors (id) ON DELETE SET NULL,
    status      text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dropped')),
    joined_on   date,
    dropped_on  date,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT students_dropped_has_date CHECK (status = 'active' OR dropped_on IS NOT NULL)
);
CREATE INDEX students_full_name_trgm ON students USING gin (lower(full_name) gin_trgm_ops);
CREATE INDEX students_degree_section ON students (degree_code, section);
CREATE INDEX students_poc ON students (poc_id);
CREATE INDEX students_coach ON students (coach_id);

-- applies_to is 'ALL' or a degree code. A foreign key can't express "ALL or a
-- degree", so the degree case is validated in Go.
CREATE TABLE calendar_days (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date       date    NOT NULL,
    applies_to text    NOT NULL CHECK (applies_to = upper(applies_to)),
    day_type   text    NOT NULL CHECK (day_type IN ('working', 'holiday', 'exam', 'event')),
    counts     boolean NOT NULL,
    label      text    NOT NULL DEFAULT '',
    CONSTRAINT calendar_days_date_applies_to UNIQUE (date, applies_to)
);

CREATE TABLE attendance (
    niat_id    text        NOT NULL REFERENCES students (niat_id) ON DELETE CASCADE,
    date       date        NOT NULL,
    status     char(1)     NOT NULL CHECK (status IN ('P', 'A')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by bigint      REFERENCES admins (id) ON DELETE SET NULL,
    PRIMARY KEY (niat_id, date)
);
CREATE INDEX attendance_date ON attendance (date);

CREATE TABLE settings (
    key   text  PRIMARY KEY,
    value jsonb NOT NULL
);

CREATE TABLE import_batches (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    kind        text        NOT NULL CHECK (kind IN ('students', 'coaches', 'attendance', 'calendar')),
    file_name   text        NOT NULL,
    uploaded_by bigint      REFERENCES admins (id) ON DELETE SET NULL,
    status      text        NOT NULL DEFAULT 'previewed' CHECK (status IN ('previewed', 'committed', 'discarded')),
    summary     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    rows        jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX import_batches_created_at ON import_batches (created_at DESC);
