"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { DayStatus, Legend, MarkChip, PctBadge, TermRange, bandInfo, fmtDay, fmtMonth } from "@/components/attendance-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api, pctText, type MonthDay } from "@/lib/api";

const inputCls =
  "h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15";

function nonCountedText(d: MonthDay) {
  if (d.label) return d.label;
  if (d.kind === "sunday") return "Sunday";
  if (d.kind === "holiday") return "Holiday";
  if (d.excluded === "before_join") return "Before joining";
  if (d.excluded === "outside_term") return "Outside semester";
  return "Not counted";
}

export function StudentLookup() {
  const [input, setInput] = useState("");
  const [id, setId] = useState("");
  const [month, setMonth] = useState("");

  const profile = useQuery({ queryKey: ["profile", id], queryFn: () => api.profile(id), enabled: id !== "", retry: false });
  const p = profile.data;
  const ym = month || p?.months.at(-1)?.month || p?.today.slice(0, 7) || "";
  const history = useQuery({
    queryKey: ["month", id, ym],
    queryFn: () => api.month(id, ym),
    enabled: profile.isSuccess && ym !== "",
  });
  const days = (history.data?.days ?? []).filter((d) => d.date <= (history.data?.today ?? "")).reverse();

  const clear = () => {
    setInput("");
    setId("");
    setMonth("");
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
          setMonth("");
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

      {p && (
        <>
          <Card>
            <CardContent className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold">{p.student.name}</h2>
                <p className="font-mono text-sm text-muted-foreground">{p.student.niat_id}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                  <Field label="Degree" value={p.student.degree} />
                  <Field label="Section" value={p.student.section} />
                  <Field label="POC" value={p.student.poc || "Not assigned"} />
                  <Field label="Success coach" value={p.student.coach || "Not assigned"} />
                </dl>
                <p className="mt-2 text-xs text-muted-foreground">
                  <TermRange term={p.term} /> · data up to {fmtDay(p.today)}
                </p>
              </div>
              <div className="flex flex-col items-start gap-1 md:items-end">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Attendance</span>
                <span className="text-5xl font-semibold tabular-nums text-primary">{pctText(p.summary.pct)}</span>
                {p.summary.band !== "none" && (
                  <span className={`rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${bandInfo[p.summary.band].cls}`}>
                    {bandInfo[p.summary.band].label}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Tile label="Working days so far" value={p.summary.counted_days} />
            <Tile label="Days present" value={p.summary.days_attended} tone="text-green-700" />
            <Tile label="Days absent" value={p.summary.days_absent} tone="text-red-700" />
            <Tile label="Not marked (sessions)" value={p.summary.not_marked_sessions} tone="text-slate-600" />
          </div>

          <div className="grid gap-6 lg:grid-cols-5">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>Monthly summary</CardTitle>
                <CardDescription>Select a month to see its history.</CardDescription>
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
                  <CardTitle>Attendance history</CardTitle>
                  <select
                    value={ym}
                    onChange={(e) => setMonth(e.target.value)}
                    className="h-9 rounded-md border border-input bg-white px-2 text-sm"
                    aria-label="Month"
                  >
                    {p.months.map((m) => (
                      <option key={m.month} value={m.month}>
                        {fmtMonth(m.month)}
                      </option>
                    ))}
                  </select>
                </div>
                <CardDescription>Newest first.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Legend />
                <ul className="divide-y divide-border rounded-md border border-border">
                  {days.map((d) => (
                    <li key={d.date} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                      <span className="w-28 font-medium">{fmtDay(d.date)}</span>
                      {d.counted ? (
                        <>
                          <span className="w-28">
                            <DayStatus fh={d.fh} sh={d.sh} />
                          </span>
                          <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                            FH <MarkChip mark={d.fh} short /> SH <MarkChip mark={d.sh} short />
                          </span>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">{nonCountedText(d)}</span>
                      )}
                    </li>
                  ))}
                  {history.isSuccess && days.length === 0 && <li className="px-3 py-3 text-sm text-muted-foreground">No days yet.</li>}
                </ul>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
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
