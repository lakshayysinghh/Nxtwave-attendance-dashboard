"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { Legend, PctBadge, TermRange, bandInfo, fmtDate, fmtDay, fmtMonth } from "@/components/attendance-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, pctText, type Month, type MonthDay, type Placement, type Profile } from "@/lib/api";

const inputCls =
  "h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15";

function nonCountedText(d: MonthDay) {
  if (d.label) return d.label;
  if (d.kind === "sunday") return "Sunday";
  if (d.kind === "holiday") return "Holiday";
  if (d.excluded === "before_join") return "Before joining";
  if (d.excluded === "after_drop") return "After dropping";
  if (d.excluded === "outside_term") return "Outside semester";
  return "Not counted";
}

/** The student view: look up a profile by exact NIAT ID. */
export function StudentLookup() {
  const [input, setInput] = useState("");
  const [id, setId] = useState("");

  const profile = useQuery({ queryKey: ["profile", id], queryFn: () => api.profile(id), enabled: id !== "", retry: false });
  const p = profile.data;

  const clear = () => {
    setInput("");
    setId("");
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Check your attendance</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter your exact NIAT ID to see your attendance percentage and history.</p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setId(input.trim().toUpperCase());
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="NIAT ID, e.g. N99H01A0001"
          className={`${inputCls} font-mono uppercase placeholder:normal-case placeholder:font-sans`}
          aria-label="NIAT ID"
          autoFocus
        />
        <div className="flex gap-2">
          <Button type="submit" className="h-10 flex-1 px-5 sm:flex-none" disabled={input.trim() === ""}>
            View attendance
          </Button>
          {(input || id) && (
            <Button type="button" variant="outline" className="h-10" onClick={clear}>
              Clear
            </Button>
          )}
        </div>
      </form>

      {profile.isFetching && !p && <p className="text-sm text-muted-foreground">Loading…</p>}
      {profile.error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {profile.error.message} Check the ID and try again.
        </p>
      )}

      {p && <StudentProfile key={p.student.niat_id} p={p} monthKey="month" fetchMonth={(ym) => api.month(p.student.niat_id, ym)} />}
    </div>
  );
}

/**
 * Everything a student sees about their attendance: header, term %, placement
 * cautions, counts, monthly summary and a month calendar. Shared by the
 * student view and the admin student page, so the two always show the same
 * numbers. extraFields adds admin-only details to the header; onSaveRemark
 * lets admins edit the monthly remarks.
 */
export function StudentProfile({
  p,
  fetchMonth,
  monthKey,
  extraFields = [],
  onSaveRemark,
}: {
  p: Profile;
  fetchMonth: (ym: string) => Promise<Month>;
  monthKey: string;
  extraFields?: { label: string; value: string }[];
  onSaveRemark?: (ym: string, remark: string) => Promise<unknown>;
}) {
  const [month, setMonth] = useState("");
  const ym = month || p.months.at(-1)?.month || p.today.slice(0, 7);
  const history = useQuery({ queryKey: [monthKey, p.student.niat_id, ym], queryFn: () => fetchMonth(ym) });
  const s = p.student;

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{s.name}</h2>
            <p className="font-mono text-sm text-muted-foreground">{s.niat_id}</p>
            <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
              <Field label="Degree" value={s.degree} />
              <Field label="Section" value={s.section} />
              <Field label="Level" value={s.level || "–"} />
              <Field label="Hall" value={s.hall_no || "–"} />
              <Field label="POC" value={s.poc || "Not assigned"} />
              <Field label="Success coach" value={s.coach || "Not assigned"} />
              {extraFields.map((f) => (
                <Field key={f.label} label={f.label} value={f.value} />
              ))}
            </dl>
            <p className="mt-2 text-xs text-muted-foreground">
              <TermRange term={p.term} /> · data up to {fmtDay(p.today)}
            </p>
          </div>
          <div className="flex flex-col items-start gap-1 md:items-end">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attendance</span>
            <span className="text-5xl font-semibold tabular-nums text-primary">{pctText(p.summary.pct)}</span>
            {p.summary.band !== "none" ? (
              <span className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${bandInfo[p.summary.band].cls}`}>
                {bandInfo[p.summary.band].label}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">No marks yet</span>
            )}
          </div>
        </CardContent>
      </Card>

      <PlacementCautions p={p} onSaveRemark={onSaveRemark} />

      <div className="grid grid-cols-3 gap-3">
        <Tile label="Working days so far" value={p.summary.counted_days} />
        <Tile label="Days present" value={p.summary.days_attended} tone="text-green-700" />
        <Tile label="Days absent" value={p.summary.days_absent} tone="text-red-700" />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly summary</CardTitle>
            <CardDescription>Select a month to see its calendar.</CardDescription>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Month</th>
                  <th className="pb-2 text-right font-medium">Days</th>
                  <th className="pb-2 text-right font-medium">Present</th>
                  <th className="pb-2 text-right font-medium">Absent</th>
                  <th className="pb-2 text-right font-medium">%</th>
                </tr>
              </thead>
              <tbody>
                {p.months.map((m) => (
                  <tr
                    key={m.month}
                    onClick={() => setMonth(m.month)}
                    className={`cursor-pointer border-t border-border ${m.month === ym ? "bg-accent font-medium" : "hover:bg-muted"}`}
                  >
                    <td className="py-2">{fmtMonth(m.month)}</td>
                    <td className="py-2 text-right tabular-nums">{m.counted_days}</td>
                    <td className="py-2 text-right tabular-nums">{m.days_attended}</td>
                    <td className="py-2 text-right tabular-nums">{m.days_absent}</td>
                    <td className="py-2 text-right">
                      <PctBadge pct={m.pct} band={m.band} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Attendance calendar</CardTitle>
              <select value={ym} onChange={(e) => setMonth(e.target.value)} className="h-9 rounded-md border border-input bg-white px-2 text-sm" aria-label="Month">
                {p.months.map((m) => (
                  <option key={m.month} value={m.month}>
                    {fmtMonth(m.month)}
                  </option>
                ))}
              </select>
            </div>
            <CardDescription>{fmtMonth(ym)}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Legend showNotMarked={false} />
            {history.error ? (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                Couldn&apos;t load this month: {history.error.message}
              </p>
            ) : (
              <MonthCalendar days={history.data?.days ?? []} today={history.data?.today ?? p.today} />
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const cellTone: Record<"P" | "A", string> = {
  P: "bg-green-50 text-green-800 ring-green-200",
  A: "bg-red-50 text-red-800 ring-red-200",
};

/** One month as a Monday-first grid. Present and Absent days are coloured; unmarked days show only the date. */
function MonthCalendar({ days, today }: { days: MonthDay[]; today: string }) {
  if (days.length === 0) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const lead = (days[0].weekday + 6) % 7;
  return (
    <div className="grid grid-cols-7 gap-1 text-center text-xs">
      {weekdays.map((w) => (
        <div key={w} className="pb-1 font-medium text-muted-foreground">
          {w}
        </div>
      ))}
      {Array.from({ length: lead }, (_, i) => (
        <div key={`lead-${i}`} />
      ))}
      {days.map((d) => {
        const future = d.date > today;
        const mark = d.counted && !future ? d.status : null;
        const note = d.counted ? "" : nonCountedText(d);
        return (
          <div
            key={d.date}
            title={`${fmtDay(d.date)}${mark ? ` · ${mark === "P" ? "Present" : "Absent"}` : note ? ` · ${note}` : ""}`}
            className={`flex min-h-14 flex-col items-center justify-start gap-0.5 rounded-md p-1 ring-1 ring-inset ${
              mark ? cellTone[mark] : d.counted ? "bg-white ring-border" : "bg-muted/60 text-muted-foreground ring-transparent"
            } ${future ? "opacity-50" : ""} ${d.date === today ? "outline-2 outline-primary" : ""}`}
          >
            <span className="font-medium tabular-nums">{Number(d.date.slice(8))}</span>
            {mark && <span className="text-sm font-semibold">{mark}</span>}
            {note && <span className="line-clamp-2 text-[10px] leading-tight">{note}</span>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Placement caution below the percentage: the term against the 95% placement
 * threshold, then each month with the admin's remark. Admins pass onSaveRemark
 * to add or edit remarks; students only read them.
 */
function PlacementCautions({ p, onSaveRemark }: { p: Profile; onSaveRemark?: (ym: string, remark: string) => Promise<unknown> }) {
  const pl = p.placement;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Placement cautions</CardTitle>
        <CardDescription>Placements need at least {pl.threshold}% attendance, for the term and in every month.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {pl.pct === null ? (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">No attendance marked yet.</p>
        ) : pl.below ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
            <b>Caution:</b> overall attendance is {pctText(pl.pct)}, below {pl.threshold}%. Placement eligibility is at risk. Attend the next{" "}
            <b>{pl.days_needed}</b> class day{pl.days_needed === 1 ? "" : "s"} without an absence to reach {pl.threshold}%.
          </p>
        ) : (
          <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            Overall attendance is {pctText(pl.pct)}: meets the {pl.threshold}% placement requirement.
          </p>
        )}
        <ul className="divide-y divide-border rounded-md border border-border">
          {pl.months.map((m) => (
            <MonthCaution key={m.month} m={m} threshold={pl.threshold} remark={p.remarks[m.month] ?? ""} onSave={onSaveRemark} />
          ))}
          {pl.months.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No months in the term yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function MonthCaution({
  m,
  threshold,
  remark,
  onSave,
}: {
  m: Placement["months"][number];
  threshold: number;
  remark: string;
  onSave?: (ym: string, remark: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(remark);
  const save = useMutation({ mutationFn: () => onSave!(m.month, text.trim()), onSuccess: () => setEditing(false) });
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-32 font-medium">{fmtMonth(m.month)}</span>
        <PctBadge pct={m.pct} band={m.pct === null ? "none" : m.below ? "below_60" : "75_plus"} />
        {m.pct === null ? (
          <span className="text-xs text-muted-foreground">No marks</span>
        ) : m.below ? (
          <span className="text-xs font-medium text-red-700">Below {threshold}%: caution</span>
        ) : (
          <span className="text-xs text-green-700">OK</span>
        )}
        {onSave && !editing && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              setText(remark);
              setEditing(true);
            }}
          >
            {remark ? "Edit remark" : "Add remark"}
          </Button>
        )}
      </div>
      {remark && !editing && (
        <p className="rounded bg-muted/50 px-2 py-1 text-xs">
          <span className="font-medium">Remark:</span> {remark}
        </p>
      )}
      {editing && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <input
            className={inputCls}
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Remark for ${fmtMonth(m.month)}, e.g. medical leave approved`}
            aria-label={`Remark for ${fmtMonth(m.month)}`}
            autoFocus
          />
          <div className="flex gap-2">
            <Button type="submit" className="h-10" disabled={save.isPending}>
              {save.isPending ? "Saving…" : text.trim() ? "Save" : "Remove"}
            </Button>
            <Button type="button" variant="outline" className="h-10" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {save.error && <span className="text-xs text-red-700">{save.error.message}</span>}
        </form>
      )}
    </li>
  );
}

/** Admin-only header fields for StudentProfile. */
export function adminFields(s: Profile["student"]): { label: string; value: string }[] {
  const out = [
    { label: "Status", value: s.status === "active" ? "Active" : "Dropped" },
    { label: "Joined on", value: s.joined_on ? fmtDate(s.joined_on) : "Term start" },
  ];
  if (s.dropped_on) out.push({ label: "Dropped on", value: fmtDate(s.dropped_on) });
  if (s.demo) out.push({ label: "Data", value: "Demo (N99)" });
  return out;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function Tile({ label, value, tone = "text-foreground" }: { label: string; value: number; tone?: string }) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
