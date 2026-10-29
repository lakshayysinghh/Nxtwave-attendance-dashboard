// All API calls go to same-origin /api/*; next.config rewrites them to the Go API.

export type Health = {
  status: "ok" | "degraded";
  db: "ok" | "error";
  time_ist: string;
};

export type Mark = "P" | "A" | null;

export type Summary = {
  counted_days: number;
  present_sessions: number;
  absent_sessions: number;
  not_marked_sessions: number;
  pct: number | null;
  days_attended: number;
  days_absent: number;
  band: Band;
};

export type Band = "below_60" | "60_to_75" | "75_plus" | "none";

export type Term = { id: number; name: string; start: string; end: string } | null;

export type Profile = {
  student: { niat_id: string; name: string; degree: string; section: string; poc: string; coach: string };
  term: Term;
  today: string;
  summary: Summary;
  months: (Summary & { month: string })[];
};

export type MonthDay = {
  date: string;
  kind: string;
  label: string;
  excluded: string;
  counted: boolean;
  fh: Mark;
  sh: Mark;
  day_label: string;
};

export type Month = { month: string; today: string; days: MonthDay[]; summary: Summary };

export type AdminStudent = {
  niat_id: string;
  name: string;
  degree: string;
  section: string;
  status: string;
  summary: Summary;
  band: Band;
};

export type Overview = {
  students: number;
  average_pct: number | null;
  below_threshold: number;
  threshold: number;
  bands: Record<Band, number>;
};

export type SheetRow = { niat_id: string; name: string; degree: string; counted: boolean; reason: string; fh: Mark; sh: Mark };

export type MarkInput = { niat_id: string; date: string; half: 1 | 2; status: Mark };

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
  me: () => request<Me>("/api/auth/me"),
  login: (email: string, password: string) =>
    request<Me>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  changePassword: (current_password: string, new_password: string) =>
    request<Me>("/api/auth/password", { method: "POST", body: JSON.stringify({ current_password, new_password }) }),
  devLogin: (email: string) => request("/api/auth/dev-login", { method: "POST", body: JSON.stringify({ email }) }),
  logout: () => fetch("/api/auth/logout", { method: "POST" }),
  students: (q: string) =>
    request<{ term: Term; today: string; students: AdminStudent[]; overview: Overview }>(`/api/admin/students?q=${encodeURIComponent(q)}`),
  sheet: (date: string) =>
    request<{ date: string; today: string; students: SheetRow[] }>(`/api/admin/attendance/sheet?date=${date}`),
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
};

type UploadOpts = { commit?: boolean; skipErrors?: boolean };

/** Uploads a sheet to an import endpoint: a preview by default, or saves it with commit. */
async function uploadSheet<T>(kind: "students" | "attendance" | "calendar", file: File, opts: UploadOpts): Promise<T> {
  const form = new FormData();
  form.append("file", file);
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
  header_errors: string[];
  missing_dates: MissingDate[];
  summary: {
    rows: number;
    students_affected: number;
    records_to_update: number;
    unchanged_records: number;
    blank_cells: number;
    skipped_cells: number;
    error_rows: number;
  };
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
  update: (id: number, change: { active?: boolean; role?: "owner" | "admin" }) =>
    request<AdminAccount>(`/api/admin/admins/${id}`, { method: "PATCH", body: JSON.stringify(change) }),
};

export type TermRow = { id: number; name: string; start: string; end: string; is_current: boolean };
export type DayType = "working" | "holiday" | "exam" | "event";

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
  in_term: boolean;
  counted: boolean;
  entries: CalendarEntry[];
};

export const calendarApi = {
  month: (ym: string, view: string) =>
    request<{ month: string; view: string; today: string; applies_to: string[]; days: CalendarDay[] }>(
      `/api/admin/calendar?ym=${ym}&view=${encodeURIComponent(view)}`,
    ),
  set: (e: { from: string; to: string; applies_to: string; day_type: DayType; counts?: boolean; label: string; include_sundays: boolean }) =>
    request<{ saved: number; warning?: string }>("/api/admin/calendar", { method: "PUT", body: JSON.stringify(e) }),
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
};

export const importCalendar = (file: File, opts: UploadOpts = {}) => uploadSheet<CalendarImportResult>("calendar", file, opts);

/** Save single-date calendar entries in one go (e.g. picked missing dates). */
export const saveCalendarEntries = (entries: { date: string; applies_to: string; day_type: DayType; label: string }[]) =>
  request<{ saved: number; warning?: string }>("/api/admin/calendar/entries", { method: "PUT", body: JSON.stringify(entries) });
