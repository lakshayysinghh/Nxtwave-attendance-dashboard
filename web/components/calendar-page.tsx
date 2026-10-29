"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fmtDate, fmtMonth } from "@/components/attendance-ui";
import { inputCls } from "@/components/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { calendarApi, type CalendarDay, type DayType } from "@/lib/api";

const kindStyle: Record<CalendarDay["kind"], { label: string; cls: string }> = {
  working: { label: "Working", cls: "bg-white" },
  holiday: { label: "Holiday", cls: "bg-slate-100" },
  exam: { label: "Exam", cls: "bg-amber-50" },
  event: { label: "Event", cls: "bg-blue-50" },
  sunday: { label: "Sunday", cls: "bg-slate-50" },
};
const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const viewLabel = (v: string) => (v === "ALL" ? "All" : v);

function shiftMonth(ym: string, by: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function CalendarPage() {
  const [ym, setYm] = useState("");
  const [view, setView] = useState("ALL");
  const month = useQuery({ queryKey: ["calendar", ym, view], queryFn: () => calendarApi.month(ym, view), placeholderData: (p) => p });
  const shown = month.data?.month ?? ym;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [picking, setPicking] = useState(false);
  const [prefill, setPrefill] = useState<{ key: number; entry?: CalendarDay["entries"][number] }>({ key: 0 });

  const pick = (d: CalendarDay) => {
    if (picking && from) {
      const [a, b] = d.date < from ? [d.date, from] : [from, d.date];
      setFrom(a);
      setTo(b);
      setPicking(false);
    } else {
      setFrom(d.date);
      setTo(d.date);
      setPicking(true);
      const own = d.entries.find((e) => e.applies_to === view) ?? d.entries[0];
      setPrefill((p) => ({ key: p.key + 1, entry: own }));
    }
  };

  const days = month.data?.days ?? [];
  const lead = days.length ? days[0].weekday : 0;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Mon–Sat are working days and Sundays are off unless you add an entry. A degree&rsquo;s own entry wins over an &ldquo;All&rdquo; entry. Days
          outside every term never count.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setYm(shiftMonth(shown, -1))} disabled={!shown} aria-label="Previous month">
                  ‹
                </Button>
                <CardTitle className="min-w-36 text-center">{shown ? fmtMonth(shown) : "…"}</CardTitle>
                <Button variant="outline" size="sm" onClick={() => setYm(shiftMonth(shown, 1))} disabled={!shown} aria-label="Next month">
                  ›
                </Button>
              </div>
              <div className="inline-flex overflow-hidden rounded-md ring-1 ring-input" role="group" aria-label="View as">
                {(month.data?.applies_to ?? ["ALL", "BITS", "CDU"]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`border-l border-input px-3 py-1.5 text-xs font-medium first:border-l-0 ${view === v ? "bg-primary text-primary-foreground" : "bg-white hover:bg-muted"}`}
                  >
                    {viewLabel(v)}
                  </button>
                ))}
              </div>
            </div>
            <CardDescription>
              Showing what {view === "ALL" ? "every degree without its own entry" : `${view} students`} see. Click a day, then click another day to select a range.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {month.error && <p className="text-sm text-red-700">{month.error.message}</p>}
            <div className="grid grid-cols-7 gap-1 text-xs">
              {weekdays.map((w) => (
                <div key={w} className="pb-1 text-center font-medium text-muted-foreground">
                  {w}
                </div>
              ))}
              {Array.from({ length: lead }, (_, i) => (
                <div key={`lead-${i}`} />
              ))}
              {days.map((d) => {
                const selected = from && to && d.date >= from && d.date <= to;
                const others = d.entries.filter((e) => e.applies_to !== view);
                return (
                  <button
                    key={d.date}
                    type="button"
                    onClick={() => pick(d)}
                    className={`flex min-h-20 flex-col items-start gap-0.5 rounded-md border p-1.5 text-left ${kindStyle[d.kind].cls} ${
                      selected ? "border-primary ring-2 ring-primary" : "border-border hover:border-primary/50"
                    } ${d.in_term ? "" : "opacity-50"} ${d.date === month.data?.today ? "outline outline-1 outline-offset-1 outline-primary" : ""}`}
                  >
                    <span className="font-semibold">{Number(d.date.slice(8))}</span>
                    {d.kind !== "working" && <span className="font-medium">{kindStyle[d.kind].label}</span>}
                    {d.label && <span className="line-clamp-2 text-[11px] leading-tight text-slate-700">{d.label}</span>}
                    {!d.in_term ? (
                      <span className="text-[11px] text-muted-foreground">Outside term</span>
                    ) : (
                      !d.counted && d.kind === "event" && <span className="text-[11px] text-muted-foreground">Not counted</span>
                    )}
                    {others.map((e) => (
                      <span key={e.applies_to} className="text-[10px] text-muted-foreground">
                        {viewLabel(e.applies_to)}: {kindStyle[e.day_type].label}
                      </span>
                    ))}
                  </button>
                );
              })}
            </div>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {(["working", "holiday", "exam", "event", "sunday"] as const).map((k) => (
                <span key={k} className="flex items-center gap-1.5">
                  <span className={`inline-block size-3 rounded-sm border border-border ${kindStyle[k].cls}`} /> {kindStyle[k].label}
                </span>
              ))}
              <span>Faded = outside any term</span>
            </p>
          </CardContent>
        </Card>

        <EntryEditor
          key={prefill.key}
          from={from}
          to={to}
          setFrom={setFrom}
          setTo={setTo}
          view={view}
          appliesOptions={month.data?.applies_to ?? ["ALL", "BITS", "CDU"]}
          prefill={prefill.entry}
        />
      </div>
    </>
  );
}

function EntryEditor({
  from,
  to,
  setFrom,
  setTo,
  view,
  appliesOptions,
  prefill,
}: {
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  view: string;
  appliesOptions: string[];
  prefill?: CalendarDay["entries"][number];
}) {
  const qc = useQueryClient();
  const [appliesTo, setAppliesTo] = useState(prefill?.applies_to ?? view);
  const [dayType, setDayType] = useState<DayType>(prefill?.day_type ?? "holiday");
  const [counts, setCounts] = useState(prefill ? prefill.counts : true);
  const [label, setLabel] = useState(prefill?.label ?? "");
  const [includeSundays, setIncludeSundays] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // Calendar changes affect every percentage, so refresh all views.
  const done = (text: string) => {
    setMsg({ ok: true, text });
    qc.invalidateQueries();
  };
  const onError = (e: Error) => setMsg({ ok: false, text: e.message });
  const save = useMutation({
    mutationFn: () =>
      calendarApi.set({ from, to: to || from, applies_to: appliesTo, day_type: dayType, counts: dayType === "event" ? counts : undefined, label, include_sundays: includeSundays }),
    onSuccess: (r) => done(`Saved ${r.saved} date(s).${r.warning ? " " + r.warning : ""}`),
    onError,
  });
  const remove = useMutation({
    mutationFn: () => calendarApi.remove(from, to || from, appliesTo),
    onSuccess: (r) => done(r.deleted ? `Removed ${r.deleted} ${viewLabel(appliesTo)} entr${r.deleted === 1 ? "y" : "ies"}; those days use the default rules again.` : "Nothing to remove."),
    onError,
  });
  const range = from ? (to && to !== from ? `${fmtDate(from)} to ${fmtDate(to)}` : fmtDate(from)) : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit days</CardTitle>
        <CardDescription>{range ? `Selected: ${range}` : "Select a day or a range on the calendar, or enter dates here."}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setMsg(null);
            if (!from) return setMsg({ ok: false, text: "Choose a start date." });
            save.mutate();
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              From
              <input className={inputCls} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              To
              <input className={inputCls} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Applies to
            <select className={inputCls} value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)}>
              {appliesOptions.map((a) => (
                <option key={a} value={a}>
                  {a === "ALL" ? "All degrees" : `${a} only`}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Day type
            <select className={inputCls} value={dayType} onChange={(e) => setDayType(e.target.value as DayType)}>
              <option value="holiday">Holiday (not counted)</option>
              <option value="exam">Exam (not counted)</option>
              <option value="event">Event</option>
              <option value="working">Working (counted, e.g. a make-up Sunday)</option>
            </select>
          </label>
          {dayType === "event" && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={counts} onChange={(e) => setCounts(e.target.checked)} />
              Counts toward attendance
            </label>
          )}
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Label (optional)
            <input className={inputCls} value={label} maxLength={100} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Diwali, Hackathon" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeSundays} onChange={(e) => setIncludeSundays(e.target.checked)} />
            Include Sundays in the range
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!from || save.isPending}>
              {save.isPending ? "Saving…" : "Save"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!from || remove.isPending}
              onClick={() => {
                setMsg(null);
                remove.mutate();
              }}
            >
              Remove {viewLabel(appliesTo)} entries
            </Button>
          </div>
          {msg && (
            <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
              {msg.text}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}
