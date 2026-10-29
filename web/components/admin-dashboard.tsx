"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, Upload } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { PageHeading } from "@/components/admin-shell";
import { DayStatus, Legend, MarkChip, PctBadge, TermRange, bandInfo, fmtDay } from "@/components/attendance-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api, pctText, type AdminStudent, type Band, type Mark, type MarkInput } from "@/lib/api";

const inputCls =
  "h-10 rounded-md border border-input bg-white px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15";

type BandKey = Exclude<Band, "none">;
const bandOrder: BandKey[] = ["below_60", "60_to_75", "75_plus"];
const isBand = (v: string | null): v is BandKey => !!v && (bandOrder as string[]).includes(v);

/** Every student with term summaries; stats always cover everyone. */
const useAllStudents = () => useQuery({ queryKey: ["students", ""], queryFn: () => api.students("") });

/** Students, average and the three band cards. Band cards call onBand. */
function SummaryCards({ band, onBand, hint }: { band?: BandKey | null; onBand: (b: BandKey) => void; hint: (on: boolean) => string }) {
  const all = useAllStudents();
  const o = all.data?.overview;
  const withData = o ? o.students - o.bands.none : 0;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <SummaryCard label="Students" value={o ? String(o.students) : "…"} />
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
          <CardContent>
            <StudentRows rows={shown} compact />
          </CardContent>
        )}
      </Card>
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

/** Students: band cards as filters, search and the full table. ?band= preselects a band. */
export function StudentsPage() {
  const params = useSearchParams();
  const initial = params.get("band");
  const [q, setQ] = useState("");
  const [band, setBand] = useState<BandKey | null>(isBand(initial) ? initial : null);
  const all = useAllStudents();
  const list = useQuery({ queryKey: ["students", q], queryFn: () => api.students(q), placeholderData: (prev) => prev });
  const o = all.data?.overview;
  const rows = (list.data?.students ?? []).filter((s) => !band || s.band === band);
  const filtered = q !== "" || band !== null;

  return (
    <>
      <PageHeading title="Students" description={<TermLine />} />

      <SummaryCards band={band} onBand={(b) => setBand(band === b ? null : b)} hint={(on) => (on ? "Showing these · click to undo" : "Click to list students")} />

      <Card>
        <CardHeader>
          <CardTitle>All students</CardTitle>
          <CardDescription>Search by name or NIAT ID, or pick a band above.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              className={`${inputCls} flex-1`}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or NIAT ID"
              aria-label="Search students"
            />
            <Button
              variant="outline"
              className="h-10"
              disabled={!filtered}
              onClick={() => {
                setQ("");
                setBand(null);
              }}
            >
              Clear filters
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {rows.length} of {o?.students ?? 0} students
            {band && <> · band: {bandInfo[band].label}</>}
            {q && <> · search: “{q}”</>}
          </p>
          <StudentRows rows={rows} />
          {list.isSuccess && rows.length === 0 && <p className="py-2 text-sm text-muted-foreground">No students match these filters.</p>}
        </CardContent>
      </Card>
    </>
  );
}

/** The existing student table (desktop) and stacked cards (phones). */
function StudentRows({ rows, compact }: { rows: AdminStudent[]; compact?: boolean }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border border-border sm:block">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">NIAT ID</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Degree</th>
              <th className="px-3 py-2 text-right font-medium">Days present</th>
              {!compact && <th className="px-3 py-2 text-right font-medium">Days absent</th>}
              <th className="px-3 py-2 text-right font-medium">Working days</th>
              <th className="px-3 py-2 text-right font-medium">Attendance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.niat_id} className="border-t border-border hover:bg-muted/60">
                <td className={`px-3 font-mono text-xs ${compact ? "py-1.5" : "py-2"}`}>{s.niat_id}</td>
                <td className="px-3 font-medium">{s.name}</td>
                <td className="px-3">{s.degree}</td>
                <td className="px-3 text-right tabular-nums">{s.summary.days_attended}</td>
                {!compact && <td className="px-3 text-right tabular-nums">{s.summary.days_absent}</td>}
                <td className="px-3 text-right tabular-nums">{s.summary.counted_days}</td>
                <td className="px-3 text-right">
                  <PctBadge pct={s.summary.pct} band={s.band} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="flex flex-col gap-2 sm:hidden">
        {rows.map((s) => (
          <li key={s.niat_id} className="rounded-md border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{s.name}</div>
                <div className="font-mono text-xs text-muted-foreground">
                  {s.niat_id} · {s.degree}
                </div>
              </div>
              <PctBadge pct={s.summary.pct} band={s.band} />
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Present {s.summary.days_attended} · Absent {s.summary.days_absent} · of {s.summary.counted_days} days
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? "text-primary" : ""}`}>{value}</div>
    </div>
  );
}

const choices: { value: Mark; label: string; on: string }[] = [
  { value: "P", label: "Present", on: "bg-green-600 text-white" },
  { value: "A", label: "Absent", on: "bg-red-600 text-white" },
  { value: null, label: "Not marked", on: "bg-slate-600 text-white" },
];

/** Whole-day marking: one choice per student, saved to both halves (FH and SH). */
export function MarkAttendance() {
  const qc = useQueryClient();
  const [date, setDate] = useState("");
  const sheet = useQuery({ queryKey: ["sheet", date], queryFn: () => api.sheet(date) });
  const [edits, setEdits] = useState<Record<string, Mark>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const day = sheet.data?.date ?? "";
  const rows = sheet.data?.students ?? [];
  const markable = rows.filter((r) => r.counted);
  const dirty = Object.keys(edits).length > 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // The current whole-day value: an edit, else the saved mark when both halves agree.
  const current = (id: string, fh: Mark, sh: Mark): Mark | "mixed" => (id in edits ? edits[id] : fh === sh ? fh : "mixed");

  const save = useMutation({
    mutationFn: () => {
      const marks: MarkInput[] = [];
      for (const r of rows) {
        if (!(r.niat_id in edits)) continue;
        const v = edits[r.niat_id];
        if (r.fh !== v) marks.push({ niat_id: r.niat_id, date: day, half: 1, status: v });
        if (r.sh !== v) marks.push({ niat_id: r.niat_id, date: day, half: 2, status: v });
      }
      return api.saveMarks(marks);
    },
    onSuccess: () => {
      setMsg({ ok: true, text: `Saved attendance for ${Object.keys(edits).length} student(s) on ${fmtDay(day)}.` });
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
        <CardDescription>Whole-day marking: the choice is saved for both halves (FH – First half, SH – Second half).</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
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
            Mark all present
          </Button>
          <Button variant="outline" disabled={!dirty} onClick={() => setEdits({})}>
            Undo changes
          </Button>
          <Button className="sm:ml-auto" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : dirty ? `Save (${Object.keys(edits).length})` : "Save"}
          </Button>
        </div>

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
          {rows.map((r) => {
            const cur = current(r.niat_id, r.fh, r.sh);
            const changed = r.niat_id in edits;
            return (
              <li key={r.niat_id} className={`flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center ${changed ? "bg-accent/60" : ""}`}>
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.name}</div>
                  <div className="flex flex-wrap items-center gap-1 font-mono text-xs text-muted-foreground">
                    {r.niat_id} · {r.degree}
                    {!changed && cur === "mixed" && (
                      <span className="ml-2 inline-flex items-center gap-1 font-sans">
                        saved: <DayStatus fh={r.fh} sh={r.sh} /> FH <MarkChip mark={r.fh} short /> SH <MarkChip mark={r.sh} short />
                      </span>
                    )}
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
      </CardContent>
    </Card>
  );
}
