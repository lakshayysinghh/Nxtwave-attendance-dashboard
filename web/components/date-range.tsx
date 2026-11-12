"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { bandInfo, fmtDate } from "@/components/attendance-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { pctText, type RangeResult, type Term } from "@/lib/api";

/**
 * Attendance between two dates. The API counts the days with the attendance
 * rules; here working days are Present + Absent (the marked class days the %
 * is taken over), and class days nobody marked are shown apart.
 */

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};
const monthStart = (day: string) => day.slice(0, 8) + "01";

/** Quick ranges ending today (IST, from the API). */
export function rangePresets(today: string, term: Term): { label: string; from: string; to: string }[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return []; // not loaded yet
  const lastMonthEnd = addDays(monthStart(today), -1);
  const out = [
    { label: "Last 7 days", from: addDays(today, -6), to: today },
    { label: "This month", from: monthStart(today), to: today },
    { label: "Last month", from: monthStart(lastMonthEnd), to: lastMonthEnd },
  ];
  if (term) out.push({ label: "Whole term", from: term.start, to: term.end < today ? term.end : today });
  return out;
}

export const rangeInputCls =
  "h-9 rounded-md border border-input bg-white px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

/** From / To inputs with quick presets. */
export function RangePicker({
  from,
  to,
  today,
  term,
  onChange,
}: {
  from: string;
  to: string;
  today: string;
  term: Term;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <input type="date" className={rangeInputCls} value={from} max={to || today || undefined} onChange={(e) => onChange(e.target.value, to)} aria-label="From date" />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <input type="date" className={rangeInputCls} value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} aria-label="To date" />
        </label>
        {(from || to) && (
          <button type="button" className="h-9 px-1 text-sm font-medium text-primary hover:underline" onClick={() => onChange("", "")}>
            Clear dates
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {rangePresets(today, term).map((p) => {
          const on = p.from === from && p.to === to;
          return (
            <button
              key={p.label}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(p.from, p.to)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${on ? "bg-primary text-primary-foreground ring-primary" : "bg-white text-slate-700 ring-input hover:bg-muted"}`}
            >
              {p.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg bg-slate-50 px-3 py-2.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${tone ?? "text-slate-900"}`}>{value}</span>
    </div>
  );
}

/** The result for one range: working days = present + absent, and the %. */
export function RangeResultView({ r }: { r: RangeResult }) {
  const s = r.summary;
  if (r.outside_term) return <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">These dates are outside the current term, so no day counts.</p>;
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Working days" value={s.marked_days} />
        <Stat label="Present" value={s.days_attended} tone="text-green-700" />
        <Stat label="Absent" value={s.days_absent} tone="text-red-700" />
        <Stat
          label="Attendance"
          value={
            <span className="flex items-baseline gap-2">
              {pctText(s.pct)}
              {s.band !== "none" && <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${bandInfo[s.band].cls}`}>{bandInfo[s.band].label}</span>}
            </span>
          }
          tone="text-primary"
        />
      </div>
      <p className="text-sm text-slate-600">
        {fmtDate(r.from)} – {fmtDate(r.to)}: present <b>{s.days_attended}</b> + absent <b>{s.days_absent}</b> = <b>{s.marked_days}</b> working day
        {s.marked_days === 1 ? "" : "s"}
        {s.marked_days > 0 && (
          <>
            {" "}
            · present on {s.days_attended} of {s.marked_days}
          </>
        )}
        .
      </p>
      {s.not_marked_days > 0 && (
        <p className="text-xs text-muted-foreground">
          {s.not_marked_days} class day{s.not_marked_days === 1 ? "" : "s"} in this range {s.not_marked_days === 1 ? "has" : "have"} no mark yet, so{" "}
          {s.not_marked_days === 1 ? "it is not counted as a working day" : "they are not counted as working days"}.
        </p>
      )}
      {r.clipped && <p className="text-xs text-muted-foreground">Shown for the part of the dates inside the current term.</p>}
      <p className="text-xs text-muted-foreground">Holidays, exams, exam preparation days and Sundays are never working days.</p>
    </div>
  );
}

/** Card for one student's page (student view and admin). */
export function DateRangeCard({
  niatId,
  today,
  term,
  fetchRange,
  queryKey,
}: {
  niatId: string;
  today: string;
  term: Term;
  fetchRange: (from: string, to: string) => Promise<RangeResult>;
  queryKey: string;
}) {
  const [range, setRange] = useState({ from: "", to: "" });
  const ready = range.from !== "" && range.to !== "" && range.from <= range.to;
  const result = useQuery({
    queryKey: [queryKey, niatId, range.from, range.to],
    queryFn: () => fetchRange(range.from, range.to),
    enabled: ready,
    placeholderData: (p) => p,
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attendance between dates</CardTitle>
        <CardDescription>Pick a From and To date to see the working days, present and absent days and the % for just those days.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <RangePicker from={range.from} to={range.to} today={today} term={term} onChange={(from, to) => setRange({ from, to })} />
        {!ready && <p className="text-sm text-muted-foreground">{range.from && range.to ? "The To date must be on or after the From date." : "Choose both dates."}</p>}
        {ready && result.error && <p className="text-sm text-red-700">{result.error.message}</p>}
        {ready && result.data && <RangeResultView r={result.data} />}
      </CardContent>
    </Card>
  );
}
