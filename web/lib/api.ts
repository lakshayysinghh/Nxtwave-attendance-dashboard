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
  me: () => request<{ id: number; email: string }>("/api/auth/me"),
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
async function uploadSheet<T>(kind: "students" | "attendance", file: File, opts: UploadOpts): Promise<T> {
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
