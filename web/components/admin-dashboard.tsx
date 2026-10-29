"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, Upload, UserPlus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { PageHeading } from "@/components/admin-shell";
import { HealthStatus } from "@/components/health-status";
import { StudentFormCard } from "@/components/student-form";
import { Legend, PctBadge, TermRange, bandInfo, fmtDay } from "@/components/attendance-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api, pctText, type AdminStudent, type Band, type Mark, type MarkInput } from "@/lib/api";

const inputCls =
  "h-10 rounded-md border border-input bg-white px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15";

type BandKey = Exclude<Band, "none">;
const bandOrder: BandKey[] = ["below_60", "60_to_75", "75_plus"];
const isBand = (v: string | null): v is BandKey => !!v && (bandOrder as string[]).includes(v);

/** Select value for "students with no hall" (the API uses hall=""). */
const NO_HALL = "__none__";
const hallLabel = (h: string) => h || "No hall";

/** Every student with term summaries; stats always cover everyone. */
const useAllStudents = () => useQuery({ queryKey: ["students", "all"], queryFn: () => api.students() });

export const studentHref = (id: string) => `/admin/students/${encodeURIComponent(id)}`;

/** Students, average and the three band cards. Band cards call onBand. */
function SummaryCards({ band, onBand, hint }: { band?: BandKey | null; onBand: (b: BandKey) => void; hint: (on: boolean) => string }) {
  const all = useAllStudents();
  const o = all.data?.overview;
  const withData = o ? o.students - o.bands.none : 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <SummaryCard label="Students" value={o ? String(o.students) : "…"} note={o && o.bands.none > 0 ? `${o.bands.none} with no marks yet` : undefined} />
      <SummaryCard label="Average attendance" value={o ? pctText(o.average_pct) : "…"} accent />
      {bandOrder.map((b) => {
        const count = o?.bands[b] ?? 0;
        const share = withData ? Math.round((count * 100) / withData) : 0;
        const on = band === b;
        return (
          <button
            key={b}
            type="button"
            onClick={() => onBand(b)}
            aria-pressed={on}
            className={`rounded-xl bg-card p-3 text-left ring-1 ${on ? "ring-2 ring-primary" : "ring-foreground/10 hover:ring-primary/40"} ${b === "75_plus" ? "col-span-2 lg:col-span-1" : ""}`}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={`size-2 rounded-full ${bandInfo[b].dot}`} />
              {bandInfo[b].label}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">{o ? `${share}%` : "…"}</span>
              <span className="text-sm text-muted-foreground">
                {count} student{count === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-1 text-xs text-primary">{hint(on)}</div>
          </button>
        );
      })}
    </div>
  );
}

function TermLine() {
  const all = useAllStudents();
  if (!all.data) return null;
  return (
    <>
      {all.data.term ? <TermRange term={all.data.term} /> : "No current term"} · data up to {fmtDay(all.data.today)}
    </>
  );
}

/** Overview: the numbers at a glance, students needing attention and quick actions. */
export function OverviewPage() {
  const router = useRouter();
  const all = useAllStudents();
  // Lowest first among students below 75% (the plan's default low threshold).
  const attention = (all.data?.students ?? [])
    .filter((s) => s.summary.pct !== null && (s.band === "below_60" || s.band === "60_to_75"))
    .sort((a, b) => (a.summary.pct ?? 0) - (b.summary.pct ?? 0));
  const shown = attention.slice(0, 6);
  const bands = all.data?.overview.bands;

  return (
    <>
      <PageHeading title="Overview" description={<TermLine />}>
        <QuickAction href="/admin/attendance" icon={ClipboardCheck} label="Mark attendance" primary />
        <QuickAction href="/admin/imports?tab=students" icon={Upload} label="Import students" />
        <QuickAction href="/admin/imports?tab=attendance" icon={Upload} label="Import attendance" />
      </PageHeading>

      <SummaryCards onBand={(b) => router.push(`/admin/students?band=${b}`)} hint={() => "View these students →"} />

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Students needing attention</CardTitle>
            <Link href="/admin/students" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              All students <ArrowRight className="size-4" />
            </Link>
          </div>
          <CardDescription>
            {all.data
              ? attention.length
                ? `Lowest attendance first: ${shown.length} of ${attention.length} student${attention.length === 1 ? "" : "s"} below 75%.`
                : "No student is below 75% right now."
              : "Loading…"}
          </CardDescription>
        </CardHeader>
        {shown.length > 0 && (
          <CardContent className="flex flex-col gap-3">
            <StudentRows rows={shown} compact />
            {bands && attention.length > shown.length && (
              <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <span className="text-muted-foreground">See them all:</span>
                {(["below_60", "60_to_75"] as const).map(
                  (b) =>
                    bands[b] > 0 && (
                      <Link key={b} href={`/admin/students?band=${b}`} className="font-medium text-primary hover:underline">
                        {bandInfo[b].label} ({bands[b]})
                      </Link>
                    ),
                )}
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer select-none">System status</summary>
        <div className="mt-3">
          <HealthStatus />
        </div>
      </details>
    </>
  );
}

function QuickAction({ href, icon: Icon, label, primary }: { href: string; icon: typeof Upload; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${
        primary ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-input bg-white text-slate-700 hover:bg-muted"
      }`}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}

/**
 * Students: band cards as filters, search, degree / section / hall filters and
 * the full table. Every filter lives in the URL (?q=&band=&degree=&section=&hall=),
 * so Back from a student returns to the same list.
 */
export function StudentsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const band = isBand(params.get("band")) ? (params.get("band") as BandKey) : null;
  const degree = params.get("degree") ?? "";
  const section = params.get("section") ?? "";
  const hall = params.has("hall") ? (params.get("hall") ?? "") : undefined;
  // The search box updates the URL as you type; keep its own state so typing stays smooth.
  const [q, setQ] = useState(params.get("q") ?? "");
  const [adding, setAdding] = useState(false);

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const all = useAllStudents();
  const filters = { q, degree, section, hall };
  const list = useQuery({
    queryKey: ["students", filters],
    queryFn: () => api.students(filters),
    placeholderData: (prev) => prev,
  });
  const total = all.data?.overview.students ?? 0;
  const rows = (list.data?.students ?? []).filter((s) => !band || s.band === band);
  const filtered = q !== "" || band !== null || degree !== "" || section !== "" || hall !== undefined;

  // Filter choices come from every student, so they don't shrink as you filter.
  const everyone = all.data?.students ?? [];
  const degrees = [...new Set(everyone.map((s) => s.degree))].sort();
  const sections = [...new Set(everyone.filter((s) => !degree || s.degree === degree).map((s) => s.section))].sort();
  const halls = [...new Set(everyone.map((s) => s.hall_no))].sort((a, b) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, undefined, { numeric: true })));
  const demoCount = everyone.filter((s) => s.demo).length;

  return (
    <>
      <PageHeading title="Students" description={<TermLine />}>
        <Button onClick={() => setAdding((v) => !v)}>
          <UserPlus className="size-4" /> {adding ? "Close" : "Add student"}
        </Button>
      </PageHeading>
      {adding && <StudentFormCard onDone={() => setAdding(false)} />}

      <SummaryCards
        band={band}
        onBand={(b) => setParam({ band: band === b ? null : b })}
        hint={(on) => (on ? "Showing these · click to undo" : "Click to list students")}
      />

      <Card>
        <CardHeader>
          <CardTitle>All students</CardTitle>
          <CardDescription>Search by name or NIAT ID, filter, or pick a band above. Click a student to see everything they see.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]">
            <input
              className={`${inputCls} w-full`}
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setParam({ q: e.target.value || null });
              }}
              placeholder="Search by name or NIAT ID"
              aria-label="Search students"
            />
            <FilterSelect label="Degree" value={degree} onChange={(v) => setParam({ degree: v || null, section: null })}>
              {degrees.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Section" value={section} onChange={(v) => setParam({ section: v || null })}>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </FilterSelect>
            <FilterSelect label="Hall" value={hall === undefined ? "" : hall || NO_HALL} onChange={(v) => setParam({ hall: v === "" ? null : v === NO_HALL ? "" : v })}>
              {halls.map((h) => (
                <option key={h || NO_HALL} value={h || NO_HALL}>
                  {hallLabel(h)}
                </option>
              ))}
            </FilterSelect>
            <Button
              variant="outline"
              className="h-10"
              disabled={!filtered}
              onClick={() => {
                setQ("");
                router.replace(pathname, { scroll: false });
              }}
            >
              Clear filters
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {rows.length} of {total} students
            {band && <> · band: {bandInfo[band].label}</>}
            {q && <> · search: “{q}”</>}
            {demoCount > 0 && <> · includes {demoCount} demo students (N99…)</>}
          </p>
          <StudentRows rows={rows} />
          {list.isSuccess && rows.length === 0 && <p className="py-2 text-sm text-muted-foreground">No students match these filters.</p>}
        </CardContent>
      </Card>
    </>
  );
}

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select className={`${inputCls} w-full`} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      <option value="">All {label === "Hall" ? "halls" : `${label.toLowerCase()}s`}</option>
      {children}
    </select>
  );
}

function DemoBadge() {
  return <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 ring-1 ring-inset ring-slate-200">Demo</span>;
}

function Attendance({ s }: { s: AdminStudent }) {
  if (s.summary.pct === null) return <span className="text-xs text-muted-foreground">No marks yet</span>;
  return <PctBadge pct={s.summary.pct} band={s.band} />;
}

/** The student table (desktop) and stacked cards (phones). Names and NIAT IDs open the student. */
function StudentRows({ rows, compact }: { rows: AdminStudent[]; compact?: boolean }) {
  const link = "hover:text-primary hover:underline";
  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-border sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">NIAT ID</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Degree</th>
              {!compact && <th className="px-3 py-2 font-medium">Section</th>}
              {!compact && <th className="px-3 py-2 font-medium">Hall</th>}
              <th className="px-3 py-2 text-right font-medium">Days present</th>
              {!compact && <th className="px-3 py-2 text-right font-medium">Days absent</th>}
              <th className="px-3 py-2 text-right font-medium">Working days</th>
              <th className="px-3 py-2 text-right font-medium">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.niat_id} className="border-t border-border hover:bg-muted/60">
                <td className={`px-3 font-mono text-xs ${compact ? "py-1.5" : "py-2"}`}>
                  <Link href={studentHref(s.niat_id)} className={link}>
                    {s.niat_id}
                  </Link>
                </td>
                <td className="px-3 font-medium">
                  <Link href={studentHref(s.niat_id)} className={link}>
                    {s.name}
                  </Link>
                  {s.demo && <DemoBadge />}
                  {s.status !== "active" && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(dropped)</span>}
                </td>
                <td className="px-3">{s.degree}</td>
                {!compact && <td className="px-3">{s.section}</td>}
                {!compact && <td className="px-3">{hallLabel(s.hall_no)}</td>}
                <td className="px-3 text-right tabular-nums">{s.summary.days_attended}</td>
                {!compact && <td className="px-3 text-right tabular-nums">{s.summary.days_absent}</td>}
                <td className="px-3 text-right tabular-nums">{s.summary.counted_days}</td>
                <td className="px-3 text-right">
                  <Attendance s={s} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((s) => (
          <li key={s.niat_id}>
            <Link href={studentHref(s.niat_id)} className="block rounded-md border border-border p-3 hover:bg-muted/60">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {s.name}
                    {s.demo && <DemoBadge />}
                  </div>
                  <div className="font-mono text-xs text-muted-foreground">
                    {s.niat_id} · {s.degree} · {s.section} · {hallLabel(s.hall_no)}
                  </div>
                </div>
                <Attendance s={s} />
              </div>
              <div className="mt-2 text-xs text-muted-foreground">
                Present {s.summary.days_attended} · Absent {s.summary.days_absent} · of {s.summary.counted_days} days
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function SummaryCard({ label, value, accent, note }: { label: string; value: string; accent?: boolean; note?: string }) {
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>{value}</div>
      {note && <div className="mt-1 text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

const choices: { value: Mark; label: string; on: string }[] = [
  { value: "P", label: "Present", on: "bg-green-600 text-white" },
  { value: "A", label: "Absent", on: "bg-red-600 text-white" },
  { value: null, label: "Not marked", on: "bg-slate-600 text-white" },
];

/**
 * Marking for one hall at a time: one mark per student for the day. The hall
 * is kept in the URL (?hall=).
 */
export function MarkAttendance() {
  const qc = useQueryClient();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // hall: undefined until one is picked; "" is the "No hall" group.
  const hall = params.has("hall") ? (params.get("hall") ?? "") : undefined;
  const [date, setDate] = useState("");
  const halls = useQuery({ queryKey: ["halls"], queryFn: api.halls });
  const sheet = useQuery({ queryKey: ["sheet", date, hall], queryFn: () => api.sheet(date, hall ?? ""), enabled: hall !== undefined });
  const [edits, setEdits] = useState<Record<string, Mark>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState("");

  const day = sheet.data?.date ?? "";
  const rows = sheet.data?.students ?? [];
  const term = search.trim().toLowerCase();
  // Search only narrows the list; edits to students not shown are kept and saved.
  const shown = term ? rows.filter((r) => r.name.toLowerCase().includes(term) || r.niat_id.toLowerCase().includes(term)) : rows;
  const markable = shown.filter((r) => r.counted);
  const dirty = Object.keys(edits).length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const pickHall = (h: string) => {
    if (h === hall) return;
    if (dirty && !window.confirm("Discard unsaved changes?")) return;
    setEdits({});
    setMsg(null);
    setSearch("");
    router.replace(`${pathname}?${new URLSearchParams({ hall: h })}`, { scroll: false });
  };

  const current = (id: string, saved: Mark): Mark => (id in edits ? edits[id] : saved);

  const save = useMutation({
    mutationFn: () => {
      const marks: MarkInput[] = [];
      for (const r of rows) {
        if (!(r.niat_id in edits)) continue;
        const v = edits[r.niat_id];
        if (r.status !== v) marks.push({ niat_id: r.niat_id, date: day, status: v });
      }
      return api.saveMarks(marks);
    },
    onSuccess: () => {
      setMsg({ ok: true, text: `Saved attendance for ${Object.keys(edits).length} student(s) in ${hallLabel(hall ?? "")} on ${fmtDay(day)}.` });
      setEdits({});
      qc.invalidateQueries({ queryKey: ["sheet"] });
      qc.invalidateQueries({ queryKey: ["students"] });
    },
    onError: (err) => {
      const details = err instanceof ApiError && Array.isArray(err.details) ? err.details : [];
      setMsg({ ok: false, text: [err.message, ...details.map((d: { niat_id: string; message: string }) => `${d.niat_id}: ${d.message}`)].join(" ") });
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mark attendance</CardTitle>
        <CardDescription>
          Pick a hall, then mark each student Present or Absent for the day.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Hall">
          {halls.data?.halls.map((h) => {
            const on = hall === h.hall;
            return (
              <button
                key={h.hall || NO_HALL}
                type="button"
                aria-pressed={on}
                onClick={() => pickHall(h.hall)}
                className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ring-1 ring-inset ${
                  on ? "bg-primary text-primary-foreground ring-primary" : "bg-white text-slate-700 ring-input hover:bg-muted"
                }`}
              >
                {hallLabel(h.hall)}
                <span className={`tabular-nums text-xs ${on ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{h.students}</span>
              </button>
            );
          })}
          {halls.isSuccess && halls.data.halls.length === 0 && <p className="text-sm text-muted-foreground">No active students yet.</p>}
        </div>

        {hall === undefined ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-6 text-center text-sm text-muted-foreground">
            Pick a hall above to list its students.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                Date
                <input
                  type="date"
                  className={inputCls}
                  value={day}
                  max={sheet.data?.today}
                  onChange={(e) => {
                    if (dirty && !window.confirm("Discard unsaved changes?")) return;
                    setEdits({});
                    setMsg(null);
                    setDate(e.target.value);
                  }}
                />
              </label>
              <Button
                variant="outline"
                disabled={!markable.length}
                onClick={() => setEdits((e) => ({ ...e, ...Object.fromEntries(markable.map((r) => [r.niat_id, "P" as Mark])) }))}
              >
                {term ? `Mark ${markable.length} shown present` : "Mark all present"}
              </Button>
              <Button variant="outline" disabled={!dirty} onClick={() => setEdits({})}>
                Undo changes
              </Button>
              <Button className="sm:ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : dirty ? `Save (${Object.keys(edits).length})` : "Save"}
              </Button>
            </div>

            <input
              className={`${inputCls} w-full`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`Search ${hallLabel(hall)} by name or NIAT ID`}
              aria-label="Search students in this hall"
            />
            <p className="text-xs text-muted-foreground">
              {hallLabel(hall)}: {term ? `${shown.length} of ${rows.length}` : rows.length} student{rows.length === 1 ? "" : "s"}
              {term && " match the search"}. Names open in a new tab, so unsaved marks stay here.
            </p>

            {rows.length > 0 && markable.length === 0 && (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {rows[0].reason} Attendance cannot be marked for this date.
              </p>
            )}
            {msg && (
              <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                {msg.text}
              </p>
            )}
            <Legend />

            <ul className="divide-y divide-border rounded-md border border-border">
              {shown.map((r) => {
                const cur = current(r.niat_id, r.status);
                const changed = r.niat_id in edits;
                return (
                  <li key={r.niat_id} className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center ${changed ? "bg-accent/60" : ""}`}>
                    <div className="flex-1">
                      <Link href={studentHref(r.niat_id)} target="_blank" className="text-sm font-medium hover:text-primary hover:underline">
                        {r.name}
                      </Link>
                      <div className="flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
                        {r.niat_id} · {r.degree} · {r.section}
                      </div>
                    </div>
                    {r.counted ? (
                      <div className="inline-flex self-start overflow-hidden rounded-md ring-1 ring-input sm:self-auto" role="group" aria-label={`Attendance for ${r.name}`}>
                        {choices.map((c) => {
                          const on = cur === c.value;
                          return (
                            <button
                              key={c.label}
                              type="button"
                              aria-pressed={on}
                              onClick={() => setEdits((e) => ({ ...e, [r.niat_id]: c.value }))}
                              className={`border-l border-input px-3 py-1.5 text-xs font-medium first:border-l-0 ${on ? c.on : "bg-white text-slate-700 hover:bg-muted"}`}
                            >
                              {c.label}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">{r.reason}</span>
                    )}
                  </li>
                );
              })}
            </ul>
            {term && shown.length === 0 && <p className="text-sm text-muted-foreground">No student in {hallLabel(hall)} matches “{search.trim()}”.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
