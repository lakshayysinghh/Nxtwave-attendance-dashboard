// All API calls go to same-origin /api/*; next.config rewrites them to the Go API.

export type Health = {
  status: "ok" | "degraded";
  db: "ok" | "error";
  time_ist: string;
};

export type Mark = "P" | "A" | null;

export type Summary = {
  counted_days: number;
  days_attended: number;
  days_absent: number;
  not_marked_days: number;
  /** Present + Absent: the counted days with a mark (the % is taken over these). */
  marked_days: number;
  pct: number | null;
  band: Band;
};

export type Band = "below_60" | "60_to_75" | "75_plus" | "none";

export type Term = { id: number; name: string; start: string; end: string } | null;

export type Profile = {
  student: {
    niat_id: string;
    name: string;
    degree: string;
    section: string;
    level: string;
    hall_no: string;
    poc: string;
    coach: string;
    status: string;
    /** Admin view only. */
    joined_on?: string;
    dropped_on?: string;
    demo?: boolean;
  };
  term: Term;
  today: string;
  summary: Summary;
  months: (Summary & { month: string })[];
  placement: Placement;
  /** Admin remarks by month (YYYY-MM). */
  remarks: Record<string, string>;
  /** Internship and registration-pending periods; cancelled ones only in the admin view. */
  periods: Period[];
};

export type PeriodKind = "INTERNSHIP" | "REGISTRATION_PENDING";

/** An internship or registration-pending period of one student. */
export type Period = {
  id: number;
  kind: PeriodKind;
  start: string;
  end: string;
  /** Registration only: the day an import showed it done; "" while pending. */
  completed_on: string;
  source: "admin" | "import";
  state: "upcoming" | "active" | "ended" | "pending" | "completed" | "cancelled";
  /** Every day from start to end. */
  calendar_days: number;
  /** Days in the period that count for attendance, up to today. */
  attendance_days: number;
  created_at: string;
  updated_at: string;
  cancelled_at: string;
};

/** Standing against the placement attendance threshold (95%). */
export type Placement = {
  threshold: number;
  pct: number | null;
  below: boolean;
  /** Present days in a row needed to reach the threshold. */
  days_needed: number;
  months: { month: string; pct: number | null; below: boolean }[];
};

export type MonthDay = {
  date: string;
  weekday: number; // 0 = Sunday
  kind: string;
  label: string;
  /** Scope of the calendar entry that decided the day: the student's degree, "ALL", or "" (default rule). */
  applies_to: string;
  excluded: string;
  counted: boolean;
  status: Mark;
  /** INTERNSHIP or REGISTRATION_PENDING when the day's mark carries one, else "". */
  category: PeriodKind | "";
};

export type Month = { month: string; today: string; days: MonthDay[]; summary: Summary };

export type AdminStudent = {
  niat_id: string;
  name: string;
  degree: string;
  section: string;
  hall_no: string;
  status: string;
  /** N99 demo data. */
  demo: boolean;
  summary: Summary;
  band: Band;
};

/** Students list filters; hall "" means students with no hall, undefined means any hall. */
/** term is a term id; empty means the current term. */
export type StudentFilters = { q?: string; degree?: string; section?: string; hall?: string; term?: string; from?: string; to?: string };

/** A student's counts for a date range. clipped: narrowed to the current term (student view). */
export type RangeResult = { from: string; to: string; summary: Summary; clipped: boolean; outside_term: boolean };

export type Hall = { hall: string; students: number };

export type Overview = {
  students: number;
  average_pct: number | null;
  below_threshold: number;
  threshold: number;
  bands: Record<Band, number>;
};

export type SheetRow = {
  niat_id: string;
  name: string;
  degree: string;
  section: string;
  hall_no: string;
  counted: boolean;
  reason: string;
  status: Mark;
};

export type MarkInput = { niat_id: string; date: string; status: Mark };

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) },
  });
  const body = await res.json().catch(() => null);
  // /api/health answers 503 with a valid body when the DB is down; surface that body.
  if (res.ok || (path === "/api/health" && res.status === 503 && body)) return body as T;
  throw new ApiError(res.status, body?.error?.message ?? `Request failed (${res.status})`, body?.error?.details);
}

export const api = {
  health: () => request<Health>("/api/health"),
  profile: (id: string) => request<Profile>(`/api/public/students/${encodeURIComponent(id)}`),
  month: (id: string, ym: string) =>
    request<Month>(`/api/public/students/${encodeURIComponent(id)}/month?ym=${ym}`),
  range: (id: string, from: string, to: string) =>
    request<RangeResult>(`/api/public/students/${encodeURIComponent(id)}/range?${new URLSearchParams({ from, to })}`),
  adminRange: (id: string, from: string, to: string) =>
    request<RangeResult>(`/api/admin/students/${encodeURIComponent(id)}/range?${new URLSearchParams({ from, to })}`),
  me: () => request<Me>("/api/auth/me"),
  login: (email: string, password: string) =>
    request<Me>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  changePassword: (current_password: string, new_password: string) =>
    request<Me>("/api/auth/password", { method: "POST", body: JSON.stringify({ current_password, new_password }) }),
  logout: () => fetch("/api/auth/logout", { method: "POST" }),
  students: (f: StudentFilters = {}) => {
    const qs = new URLSearchParams({ q: f.q ?? "", degree: f.degree ?? "", section: f.section ?? "" });
    if (f.hall !== undefined) qs.set("hall", f.hall);
    if (f.term) qs.set("term", f.term);
    if (f.from && f.to) {
      qs.set("from", f.from);
      qs.set("to", f.to);
    }
    return request<{ term: Term; today: string; students: AdminStudent[]; overview: Overview; range: { from: string; to: string; custom: boolean } }>(
      `/api/admin/students?${qs}`,
    );
  },
  /** The admin view of one student: the student profile plus admin-only fields, for any status. */
  adminStudent: (id: string, term = "") =>
    request<Profile>(`/api/admin/students/${encodeURIComponent(id)}${term ? `?term=${encodeURIComponent(term)}` : ""}`),
  adminMonth: (id: string, ym: string) => request<Month>(`/api/admin/students/${encodeURIComponent(id)}/month?ym=${ym}`),
  halls: () => request<{ halls: Hall[] }>("/api/admin/halls"),
  /** Sets the student's remark for a month (YYYY-MM); an empty remark deletes it. */
  setRemark: (id: string, ym: string, remark: string) =>
    request<{ month: string; remark: string }>(`/api/admin/students/${encodeURIComponent(id)}/remarks/${ym}`, {
      method: "PUT",
      body: JSON.stringify({ remark }),
    }),
  sheet: (date: string, hall: string) =>
    request<{ date: string; today: string; students: SheetRow[] }>(
      `/api/admin/attendance/sheet?${new URLSearchParams({ date, hall })}`,
    ),
  saveMarks: (marks: MarkInput[]) =>
    request<{ saved: number; cleared: number }>("/api/admin/attendance", { method: "PUT", body: JSON.stringify(marks) }),
};

export type ImportRow = {
  row: number;
  niat_id: string;
  name: string;
  degree: string;
  section: string;
  action: "new" | "update" | "unchanged" | "error";
  errors: string[];
  warnings: string[];
};

export type ImportResult = {
  file_name: string;
  summary: { total: number; new: number; updated: number; unchanged: number; errors: number; warnings: number };
  rows: ImportRow[];
  committed: boolean;
  saved: number;
  /** The sheet's date columns, when it has any; saved by the same commit. */
  attendance?: AttendanceImportResult;
};

/**
 * columnDates gives a date (YYYY-MM-DD) to unreadable date headers, by 0-based column.
 * valueMap maps values that are not marks (as written in the sheet) to Present or Absent.
 */
type UploadOpts = {
  commit?: boolean;
  skipErrors?: boolean;
  columnDates?: Record<number, string>;
  valueMap?: Record<string, "P" | "A">;
};

/** Uploads a sheet to an import endpoint: a preview by default, or saves it with commit. */
async function uploadSheet<T>(kind: "students" | "attendance" | "calendar", file: File, opts: UploadOpts): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  if (opts.columnDates && Object.keys(opts.columnDates).length > 0) form.append("column_dates", JSON.stringify(opts.columnDates));
  if (opts.valueMap && Object.keys(opts.valueMap).length > 0) form.append("value_map", JSON.stringify(opts.valueMap));
  const qs = new URLSearchParams({ commit: String(!!opts.commit), skip_errors: String(!!opts.skipErrors) });
  const res = await fetch(`/api/admin/imports/${kind}?${qs}`, { method: "POST", body: form });
  const body = await res.json().catch(() => null);
  if (res.ok) return body as T;
  throw new ApiError(res.status, body?.error?.message ?? `Upload failed (${res.status})`, body?.error?.details);
}

export const importStudents = (file: File, opts: UploadOpts = {}) => uploadSheet<ImportResult>("students", file, opts);

export type AttendanceImportRow = {
  row: number;
  niat_id: string;
  name: string;
  status: "update" | "unchanged" | "error";
  changes: number;
  unchanged: number;
  blank: number;
  skipped: string[];
  errors: string[];
  warnings: string[];
};

export type AttendanceImportResult = {
  file_name: string;
  dates: string[];
  /** Unreadable date headers; read only once given a date. suggested is "" when there is no guess. */
  bad_columns: { column: number; header: string; suggested: string }[];
  header_errors: string[];
  header_warnings: string[];
  missing_dates: MissingDate[];
  summary: {
    rows: number;
    students_affected: number;
    records_to_update: number;
    unchanged_records: number;
    blank_cells: number;
    skipped_cells: number;
    error_rows: number;
    /** Internship / registration periods created or changed by the save. */
    periods_to_save: number;
  };
  /** Recognised categories: the mark each saves, how many cells, first and last date. */
  categories: { category: PeriodKind; status: "P" | "A"; cells: number; from: string; to: string }[];
  /** Values that are not saved (e.g. #REF!), most frequent first. */
  unsupported: { value: string; cells: number; reason: string }[];
  /** Values you mapped to Present or Absent. */
  mapped: { value: string; status: "P" | "A"; cells: number }[];
  /** Headers that are neither a date nor a student column; not read. */
  ignored_columns: string[];
  periods: {
    niat_id: string;
    name: string;
    kind: PeriodKind;
    start: string;
    end: string;
    completed_on: string;
    action: "new" | "extend" | "unchanged";
  }[];
  rows: AttendanceImportRow[];
  committed: boolean;
  saved: number;
};

export const importAttendance = (file: File, opts: UploadOpts = {}) =>
  uploadSheet<AttendanceImportResult>("attendance", file, opts);

export const pctText = (p: number | null) => (p === null ? "–" : `${p.toFixed(1)}%`);

export type Me = { id: number; email: string; name: string; role: "owner" | "admin"; must_change_password: boolean };

export type AdminAccount = {
  id: number;
  email: string;
  name: string;
  role: "owner" | "admin";
  active: boolean;
  has_password: boolean;
  must_change_password: boolean;
};

/** Owner-only admin management. */
export const adminsApi = {
  list: () => request<{ admins: AdminAccount[] }>("/api/admin/admins"),
  create: (name: string, email: string, password: string) =>
    request<AdminAccount>("/api/admin/admins", { method: "POST", body: JSON.stringify({ name, email, password }) }),
  resetPassword: (id: number, password: string) =>
    request<AdminAccount>(`/api/admin/admins/${id}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  update: (id: number, change: { name?: string; email?: string; active?: boolean; role?: "owner" | "admin" }) =>
    request<AdminAccount>(`/api/admin/admins/${id}`, { method: "PATCH", body: JSON.stringify(change) }),
  /** Makes an active admin an Owner; needs the signed-in Owner's own password. */
  makeOwner: (id: number, currentPassword: string) =>
    request<AdminAccount>(`/api/admin/admins/${id}/make-owner`, {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword }),
    }),
  remove: async (id: number) => {
    const res = await fetch(`/api/admin/admins/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.error?.message ?? `Delete failed (${res.status})`);
    }
  },
};

/** The add/edit student form. Blank optional fields are stored empty. */
export type StudentForm = {
  niat_id?: string; // add only; the NIAT ID cannot be changed
  name: string;
  degree: string;
  section: string;
  level: string;
  hall_no: string;
  poc: string;
  coach: string;
  status: "active" | "dropped";
  joined_on: string;
  dropped_on: string;
};

export const studentsApi = {
  create: (f: StudentForm) => request<{ niat_id: string }>("/api/admin/students", { method: "POST", body: JSON.stringify(f) }),
  update: (id: string, f: StudentForm) =>
    request<{ niat_id: string }>(`/api/admin/students/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(f) }),
  /** Owner only. Deletes the student and all their marks; confirm must repeat the NIAT ID. */
  remove: (id: string, confirm: string) =>
    request<{ deleted: string; marks_deleted: number }>(
      `/api/admin/students/${encodeURIComponent(id)}?${new URLSearchParams({ confirm })}`,
      { method: "DELETE" },
    ),
  /** Owner only. Deletes many students and all their marks; confirm must be "DELETE <count>". */
  removeMany: (niatIds: string[], confirm: string) =>
    request<{ deleted: number; not_found: number; marks_deleted: number }>("/api/admin/students/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ niat_ids: niatIds, confirm }),
    }),
};

/** An existing mark an internship would replace. */
export type InternshipConflict = { date: string; status: "P" | "A"; category: PeriodKind | "" };

export type InternshipResult = {
  dry_run: boolean;
  period: Period | null;
  /** Days added to the internship. */
  days: number;
  conflicts: InternshipConflict[];
  marks_saved: number;
  /** Conflicting marks left as they were (overwrite off). */
  marks_kept: number;
  /** INTERNSHIP marks removed from days no longer covered. */
  marks_removed: number;
};

export type InternshipInput = { start: string; end: string; overwrite?: boolean; dry_run?: boolean };

/** An internship on the admin calendar, with its student. */
export type InternshipListItem = Period & {
  niat_id: string;
  name: string;
  degree: string;
  section: string;
  hall_no: string;
  /** The internship covers today. */
  current: boolean;
};

/** Internship periods. Any admin; the server checks overlaps and saves marks in one transaction. */
export const internshipsApi = {
  periods: (id: string) =>
    request<{ today: string; periods: Period[] }>(`/api/admin/students/${encodeURIComponent(id)}/periods`),
  create: (id: string, input: InternshipInput) =>
    request<InternshipResult>(`/api/admin/students/${encodeURIComponent(id)}/internships`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (periodId: number, input: InternshipInput) =>
    request<InternshipResult>(`/api/admin/internships/${periodId}`, { method: "PUT", body: JSON.stringify(input) }),
  cancel: (periodId: number) =>
    request<{ cancelled: number; marks_removed: number }>(`/api/admin/internships/${periodId}/cancel`, { method: "POST" }),
  list: (from: string, to: string) =>
    request<{ from: string; to: string; today: string; current: number; internships: InternshipListItem[] }>(
      `/api/admin/internships?${new URLSearchParams({ from, to })}`,
    ),
};

export type TermRow = { id: number; name: string; start: string; end: string; is_current: boolean };
export type DayType = "working" | "holiday" | "exam" | "exam_prep" | "event";

export const termsApi = {
  list: () => request<{ terms: TermRow[]; today: string }>("/api/admin/terms"),
  create: (t: { name: string; start: string; end: string; is_current?: boolean }) =>
    request<TermRow>("/api/admin/terms", { method: "POST", body: JSON.stringify(t) }),
  update: (id: number, t: { name?: string; start?: string; end?: string; is_current?: true }) =>
    request<TermRow>(`/api/admin/terms/${id}`, { method: "PATCH", body: JSON.stringify(t) }),
  remove: async (id: number) => {
    const res = await fetch(`/api/admin/terms/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(res.status, body?.error?.message ?? `Delete failed (${res.status})`);
    }
  },
};

export type CalendarEntry = { applies_to: string; day_type: DayType; counts: boolean; label: string };
export type CalendarDay = {
  date: string;
  weekday: number;
  kind: DayType | "sunday";
  label: string;
  /** The entry that decided the day for the view: a degree, "ALL", or "" (default rule). */
  applies_to: string;
  in_term: boolean;
  counted: boolean;
  entries: CalendarEntry[];
  /** How every degree's students see this date. */
  by_degree: { degree: string; kind: DayType | "sunday"; label: string; counted: boolean; applies_to: string }[];
};

export const calendarApi = {
  month: (ym: string, view: string) =>
    request<{ month: string; view: string; today: string; applies_to: string[]; days: CalendarDay[] }>(
      `/api/admin/calendar?ym=${ym}&view=${encodeURIComponent(view)}`,
    ),
  set: (e: { from: string; to: string; applies_to: string; day_type: DayType; counts?: boolean; label: string; include_sundays: boolean }) =>
    request<{ saved: number; unchanged: number; warning?: string }>("/api/admin/calendar", { method: "PUT", body: JSON.stringify(e) }),
  remove: (from: string, to: string, applies_to: string) =>
    request<{ deleted: number }>(
      `/api/admin/calendar?${new URLSearchParams({ from, to, applies_to })}`,
      { method: "DELETE" },
    ),
};

/** A date between the first and last attendance columns with no column of its own (Sundays excluded). */
export type MissingDate = { date: string; weekday: number; entries: CalendarEntry[]; has_marks: boolean };

export type CalendarImportRow = {
  row: number;
  date: string;
  day_type: string;
  applies_to: string;
  label: string;
  counts: boolean;
  action: "new" | "update" | "unchanged" | "error";
  errors: string[];
  warnings: string[];
};

export type CalendarImportResult = {
  file_name: string;
  summary: { total: number; new: number; updated: number; unchanged: number; errors: number; warnings: number };
  rows: CalendarImportRow[];
  committed: boolean;
  saved: number;
  batch_id?: number;
};

export const importCalendar = (file: File, opts: UploadOpts = {}) => uploadSheet<CalendarImportResult>("calendar", file, opts);

/**
 * Save single-date calendar entries in one go (e.g. picked missing dates).
 * upload records them as coming from that sheet in the import history.
 */
export const saveCalendarEntries = (
  entries: { date: string; applies_to: string; day_type: DayType; label: string }[],
  upload?: { file_name: string; kind: "attendance" | "students" },
) =>
  request<{ saved: number; unchanged: number; warning?: string; batch_id?: number }>("/api/admin/calendar/entries", {
    method: "PUT",
    body: JSON.stringify({ entries, ...upload }),
  });

export type EntrySource = "legacy" | "manual" | "calendar_import" | "attendance_import" | "students_import";
export type AdminRef = { name: string; email: string } | null;

/** Consecutive calendar days saved together (Sundays left out of a range are skipped over). */
export type CalendarEntryRange = {
  start: string;
  end: string;
  days: number;
  applies_to: string;
  day_type: DayType;
  counts: boolean;
  label: string;
  source: EntrySource;
  batch: { id: number; file_name: string; kind: string } | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: AdminRef;
  updated_by: AdminRef;
  /** The exact entry dates in the range. */
  dates: string[];
  /** Fingerprint of these rows; an edit or deletion is refused if they changed since. */
  token: string;
};

/** Which entries to delete: exactly the selected ones, or imported entries matching filters (Owner only). */
export type DeletionSelector =
  | { mode: "selected"; entries: { date: string; applies_to: string }[] }
  | { mode: "imported"; batch_ids?: number[]; degrees?: string[]; types?: DayType[]; from?: string; to?: string };

export type ImpactDay = { kind: DayType | "sunday"; label: string; counts: boolean; counted: boolean };
export type CalendarImpact = {
  changes: { date: string; degree: string; before: ImpactDay; after: ImpactDay; counting_changes: boolean; marks: number }[];
  start_counting: number;
  stop_counting: number;
  marks_start: number;
  marks_stop: number;
};

export type DeletionPreview = {
  entries: CalendarEntryRange[];
  count: number;
  dates: string[];
  degrees: string[];
  types: Record<string, number>;
  /** Manual and legacy entries the same filters match; a reset keeps them. */
  kept: { manual: number; legacy: number };
  /** Selected entries that no longer exist. */
  missing: number;
  impact: CalendarImpact;
  token: string;
};

export type CalendarDeletion = {
  id: number;
  kind: "selected" | "imported";
  criteria: { dates?: string[]; degrees?: string[]; types?: Record<string, number>; kept?: { manual: number; legacy: number } };
  entry_count: number;
  deleted_at: string;
  deleted_by: AdminRef;
  restored_at: string | null;
  restored_by: AdminRef;
  restored_entries: number;
};

export type DeletedEntry = { date: string; applies_to: string; day_type: DayType; counts: boolean; label: string; source: EntrySource; file_name: string; restored: boolean };

/** A saved upload that wrote calendar entries. */
export type ImportBatch = {
  id: number;
  kind: "calendar" | "attendance" | "students";
  file_name: string;
  status: string;
  uploaded_at: string;
  uploaded_by: AdminRef;
  summary: { created: number; updated: number; unchanged: number; skipped: number; from?: string; to?: string; degrees: string[] };
  /** Entries that still point at this upload (a later save moves an entry to its own source). */
  current_entries: number;
};

export const calendarEntriesApi = {
  list: () => request<{ entries: CalendarEntryRange[] }>("/api/admin/calendar/entries"),
  history: () => request<{ batches: ImportBatch[] }>("/api/admin/imports/history"),
  previewDelete: (sel: DeletionSelector) =>
    request<DeletionPreview>("/api/admin/calendar/deletions/preview", { method: "POST", body: JSON.stringify(sel) }),
  /** confirm: true for selected entries; "RESET <count>" for a reset of imported entries. */
  delete: (sel: DeletionSelector, token: string, confirm: true | string) =>
    request<{ deletion_id: number; deleted: number; impact: CalendarImpact }>("/api/admin/calendar/deletions", {
      method: "POST",
      body: JSON.stringify({ ...sel, token, ...(confirm === true ? { confirmed: true } : { confirm }) }),
    }),
  edit: (e: { entries: { date: string; applies_to: string }[]; token: string; day_type: DayType; counts?: boolean; label: string }) =>
    request<{ updated: number; impact: CalendarImpact }>("/api/admin/calendar/entries", { method: "PATCH", body: JSON.stringify(e) }),
  deletions: () => request<{ deletions: CalendarDeletion[] }>("/api/admin/calendar/deletions"),
  deletion: (id: number) => request<{ entries: DeletedEntry[] }>(`/api/admin/calendar/deletions/${id}`),
  restore: (id: number) => request<{ restored: number; skipped: number }>(`/api/admin/calendar/deletions/${id}/restore`, { method: "POST" }),
};
