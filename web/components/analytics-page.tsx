"use client";

import { useQuery } from "@tanstack/react-query";
import { FileDown, FileSpreadsheet, ImageDown, Printer } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState } from "react";

import { PageHeading, useCurrentAdmin } from "@/components/admin-shell";
import { fmtDate } from "@/components/attendance-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StudentSheet, byName, type SheetSort } from "@/components/student-sheet";
import { StatCard } from "@/components/ui/stat-card";
import {
  analyticsApi,
  type Analytics,
  type AnalyticsPeriod,
  type AnalyticsQuery,
  type AnalyticsShow,
  type AnalyticsStudent,
  type DayTally,
  type GroupTally,
  type Tally,
} from "@/lib/api";

/*
 * Owner-only attendance analytics. Every number comes from the API
 * (stats.Analyze); this file only lays them out. Over several days Present /
 * Absent are student-days, shown next to the average per working day.
 */

const NO_HALL = "__none__";
const hallLabel = (h: string) => h || "No hall";
const num = (n: number) => n.toLocaleString("en-IN");
const pct = (p: number | null | undefined) => (p === null || p === undefined ? "–" : `${p.toFixed(2)}%`);
const dec = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n.toLocaleString("en-IN", { maximumFractionDigits: 1 }));
const selectCls =
  "h-9 w-full rounded-md border border-input bg-white px-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 sm:w-auto";

const periods: { id: AnalyticsPeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "last7", label: "Last 7 days" },
  { id: "lastmonth", label: "Last month" },
  { id: "custom", label: "Custom" },
];

const istTime = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const monthName = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

function periodLabel(a: Analytics) {
  const span = a.from === a.to ? fmtDate(a.from) : `${fmtDate(a.from)} – ${fmtDate(a.to)}`;
  switch (a.period) {
    case "today":
      return `Today · ${span}`;
    case "last7":
      return `Last 7 days · ${span}`;
    case "lastmonth":
      return `Last month · ${monthName.format(new Date(a.from + "T00:00:00Z"))}`;
    default:
      return span;
  }
}

function scopeLabel(a: Analytics) {
  const parts = [a.filter.degree || "All degrees", a.filter.hall === null ? "All halls" : hallLabel(a.filter.hall)];
  if (a.filter.section) parts.push(`Section ${a.filter.section}`);
  return parts.join(" · ");
}

export function AnalyticsPage() {
  const owner = useCurrentAdmin().role === "owner";
  if (!owner) {
    return (
      <>
        <PageHeading title="Analytics" />
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">Only the Owner can see Analytics.</CardContent>
        </Card>
      </>
    );
  }
  return <OwnerAnalytics />;
}

function OwnerAnalytics() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const p = params.get("period");
  const period: AnalyticsPeriod = periods.some((x) => x.id === p) ? (p as AnalyticsPeriod) : "today";
  const degree = params.get("degree") ?? "";
  const hall = params.has("hall") ? (params.get("hall") ?? "") : undefined;
  const section = params.get("section") ?? "";
  // Custom dates in state too, so changing From then To never loses one.
  const [dates, setDates] = useState({ from: params.get("from") ?? "", to: params.get("to") ?? "" });
  const customOk = dates.from !== "" && dates.to !== "" && dates.from <= dates.to;

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const query: AnalyticsQuery = { period, degree, hall, section, ...(period === "custom" ? dates : {}) };
  const res = useQuery({
    queryKey: ["analytics", query],
    queryFn: () => analyticsApi.get(query),
    enabled: period !== "custom" || customOk,
    placeholderData: (prev) => prev,
  });
  const a = res.data;
  const [drill, setDrill] = useState<Drill | null>(null);

  const reportRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  const fileBase = a ? `attendance-report-${a.from}-to-${a.to}` : "attendance-report";

  async function snapshot() {
    const node = reportRef.current!;
    const { toPng } = await import("html-to-image");
    const bg = getComputedStyle(document.body).backgroundColor;
    return {
      url: await toPng(node, { pixelRatio: 2, backgroundColor: bg, cacheBust: true }),
      w: node.offsetWidth,
      h: node.offsetHeight,
    };
  }
  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setExportError("");
    try {
      await fn();
    } catch (e) {
      setExportError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  }
  const save = (href: string, name: string) => {
    const link = document.createElement("a");
    link.href = href;
    link.download = name;
    link.click();
  };
  const exportPng = () => run("png", async () => save((await snapshot()).url, `${fileBase}.png`));
  const exportPdf = () =>
    run("pdf", async () => {
      const shot = await snapshot();
      const { jsPDF } = await import("jspdf");
      const pdf = new jsPDF({ orientation: shot.w > shot.h ? "landscape" : "portrait", unit: "px", format: [shot.w, shot.h], hotfixes: ["px_scaling"] });
      pdf.addImage(shot.url, "PNG", 0, 0, shot.w, shot.h);
      pdf.save(`${fileBase}.pdf`);
    });
  const exportExcel = () =>
    run("excel", async () => {
      const { blob, name } = await analyticsApi.excel(query);
      const url = URL.createObjectURL(blob);
      save(url, name);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

  // Filter choices come from every student; hall and section follow the degree.
  const halls = [...new Set((a?.options.halls ?? []).filter((h) => !degree || h.degree === degree).map((h) => h.value))];
  const sections = [...new Set((a?.options.sections ?? []).filter((s) => !degree || s.degree === degree).map((s) => s.value))].sort();
  const filtered = degree !== "" || hall !== undefined || section !== "" || period !== "today";
  const ready = !!a && !busy;

  return (
    <>
      <div className="print:hidden">
        <PageHeading title="Analytics" description="Attendance across degrees and halls, ready to share." help="analytics">
          <Button variant="outline" onClick={exportPdf} disabled={!ready}>
            <FileDown className="size-4" /> {busy === "pdf" ? "Preparing…" : "PDF"}
          </Button>
          <Button variant="outline" onClick={exportExcel} disabled={!ready}>
            <FileSpreadsheet className="size-4" /> {busy === "excel" ? "Preparing…" : "Excel"}
          </Button>
          <Button variant="outline" onClick={exportPng} disabled={!ready}>
            <ImageDown className="size-4" /> {busy === "png" ? "Preparing…" : "PNG"}
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!a}>
            <Printer className="size-4" /> Print
          </Button>
        </PageHeading>
      </div>

      <Card className="print:hidden">
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border border-border bg-muted/40 p-0.5" role="group" aria-label="Period">
              {periods.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={period === x.id}
                  onClick={() => setParam({ period: x.id === "today" ? null : x.id, ...(x.id === "custom" ? {} : { from: null, to: null }) })}
                  className={`rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors sm:px-3 ${period === x.id ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {x.label}
                </button>
              ))}
            </div>
            {period === "custom" && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="date"
                  aria-label="From date"
                  className={selectCls}
                  value={dates.from}
                  max={a?.today}
                  onChange={(e) => {
                    setDates((d) => ({ ...d, from: e.target.value }));
                    setParam({ from: e.target.value || null });
                  }}
                />
                <span className="text-muted-foreground">to</span>
                <input
                  type="date"
                  aria-label="To date"
                  className={selectCls}
                  value={dates.to}
                  max={a?.today}
                  onChange={(e) => {
                    setDates((d) => ({ ...d, to: e.target.value }));
                    setParam({ to: e.target.value || null });
                  }}
                />
                {!customOk && <span className="text-xs text-muted-foreground">Choose both dates (To on or after From).</span>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select className={selectCls} aria-label="Degree" value={degree} onChange={(e) => setParam({ degree: e.target.value || null, hall: null, section: null })}>
              <option value="">All degrees</option>
              {a?.options.degrees.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              className={selectCls}
              aria-label="Hall"
              value={hall === undefined ? "" : hall || NO_HALL}
              onChange={(e) => setParam({ hall: e.target.value === "" ? null : e.target.value === NO_HALL ? "" : e.target.value })}
            >
              <option value="">All halls</option>
              {halls.map((h) => (
                <option key={h || NO_HALL} value={h || NO_HALL}>
                  {hallLabel(h)}
                </option>
              ))}
            </select>
            <select className={selectCls} aria-label="Section" value={section} onChange={(e) => setParam({ section: e.target.value || null })}>
              <option value="">All sections</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              className="h-9"
              disabled={!filtered}
              onClick={() => {
                setDates({ from: "", to: "" });
                router.replace(pathname, { scroll: false });
              }}
            >
              Clear all filters
            </Button>
            {res.isFetching && <span className="text-xs text-muted-foreground">Updating…</span>}
          </div>
          {(res.error || exportError) && <p className="text-sm text-red-600">{exportError || res.error?.message}</p>}
        </CardContent>
      </Card>

      {!a ? (
        <p className="text-sm text-muted-foreground">{period === "custom" && !customOk ? "Choose the dates to see the report." : res.error ? "" : "Loading…"}</p>
      ) : (
        <div ref={reportRef} className="flex flex-col gap-5 rounded-xl bg-background p-1 print:p-0" data-testid="analytics-report">
          <ReportHeader a={a} />
          <Kpis a={a} onDrill={setDrill} />
          {a.total.working_days === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No attendance has been marked for {a.period === "today" ? "today" : "these dates"} yet, so there is nothing to compare.
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
                <DegreeSection a={a} onDrill={setDrill} />
                <InsightsCard a={a} />
              </div>
              <HallPctChart a={a} onDrill={setDrill} />
              <HallTable a={a} onDrill={setDrill} />
              {a.days > 1 && <DailyTrend a={a} />}
            </>
          )}
          <p className="px-1 text-xs text-muted-foreground">
            Attendance % = present ÷ (present + absent). Unmarked is never counted as absent. A working day is a class day on which attendance was marked
            {a.days > 1 && "; over several days present and absent are student-days (one student on one day), and “per day” is the average over the working days"}.
          </p>
        </div>
      )}
      {a && <AnalyticsDrill a={a} query={query} drill={drill} onClose={() => setDrill(null)} />}
    </>
  );
}

function ReportHeader({ a }: { a: Analytics }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border px-1 pb-4">
      <div>
        <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">DSA attendance report</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{periodLabel(a)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{scopeLabel(a)}</p>
      </div>
      <p className="text-xs text-muted-foreground">Generated {istTime.format(new Date(a.generated_at))} IST</p>
    </div>
  );
}

/* ---------- drill-down: the students behind a number ---------- */

type Focus = "pct" | "present" | "absent" | "unmarked";
/** What a click opens. degree / hall narrow the page filter (a degree or hall row). */
type Drill = { title: string; show: AnalyticsShow; focus: Focus; degree?: string; hall?: string };
type OnDrill = (d: Drill) => void;

const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
const dayMark = (r: AnalyticsStudent) => (r.present ? "Present" : r.absent ? "Absent" : "Not marked");
const byMost = (k: "present" | "absent" | "unmarked") => (x: AnalyticsStudent, y: AnalyticsStudent) => y[k] - x[k] || byName(x, y);
const byPct = (dir: 1 | -1) => (x: AnalyticsStudent, y: AnalyticsStudent) =>
  x.pct === null ? 1 : y.pct === null ? -1 : dir * (x.pct - y.pct) || byName(x, y);

function sortsFor(focus: Focus, multi: boolean): SheetSort<AnalyticsStudent>[] {
  const name = { label: "Name A–Z", compare: byName };
  if (!multi) return focus === "pct" ? [{ label: "Absent first", compare: byMost("absent") }, name] : [name];
  const low = { label: "Lowest % first", compare: byPct(1) };
  switch (focus) {
    case "pct":
      return [low, { label: "Highest % first", compare: byPct(-1) }, name];
    case "present":
      return [{ label: "Most present days", compare: byMost("present") }, low, name];
    case "absent":
      return [{ label: "Most absent days", compare: byMost("absent") }, low, name];
    default:
      return [{ label: "Most unmarked days", compare: byMost("unmarked") }, name];
  }
}

/** The page query narrowed to a degree / hall row. */
function drillQuery(query: AnalyticsQuery, d: Drill | null): AnalyticsQuery {
  if (!d) return query;
  return { ...query, ...(d.degree !== undefined ? { degree: d.degree } : {}), ...(d.hall !== undefined ? { hall: d.hall } : {}) };
}

function AnalyticsDrill({ a, query, drill, onClose }: { a: Analytics; query: AnalyticsQuery; drill: Drill | null; onClose: () => void }) {
  const multi = a.days > 1;
  const q = drillQuery(query, drill);
  const res = useQuery({
    queryKey: ["analytics-students", q, drill?.show],
    queryFn: () => analyticsApi.students(q, drill!.show),
    enabled: drill !== null,
  });
  const focus = drill?.focus ?? "pct";
  const metric = (r: AnalyticsStudent) => {
    if (!multi) return dayMark(r);
    return focus === "pct" ? pct(r.pct) : days(r[focus]);
  };
  const scope = { ...a, filter: { ...a.filter, degree: q.degree ?? "", hall: q.hall === undefined ? null : q.hall, section: q.section ?? "" } };
  return (
    <StudentSheet
      key={drill ? drill.title + drill.show + (drill.degree ?? "") + (drill.hall ?? "") : "closed"}
      open={drill !== null}
      onOpenChange={(o) => !o && onClose()}
      title={drill?.title ?? ""}
      description={`${periodLabel(a)} · ${scopeLabel(scope)}`}
      rows={res.data?.students}
      loading={res.isPending}
      error={res.error?.message}
      metric={metric}
      detail={multi ? (r) => `Present ${r.present} · Absent ${r.absent} · Unmarked ${r.unmarked} · ${pct(r.pct)}` : undefined}
      sorts={sortsFor(focus, multi)}
      emptyText="No student in this group."
    />
  );
}

function Change({ a }: { a: Analytics }) {
  const c = a.insights.change;
  if (c === null) return <>{a.days === 1 ? "No earlier working day in the last 14 days" : "No marks in the previous period"} to compare</>;
  const word = c > 0 ? "up" : c < 0 ? "down" : "no change";
  return (
    <>
      {c > 0 ? "▲" : c < 0 ? "▼" : "■"} {c === 0 ? word : `${word} ${Math.abs(c).toFixed(2)} pts`} vs{" "}
      {a.period === "lastmonth"
        ? monthName.format(new Date(a.previous.from + "T00:00:00Z"))
        : a.previous.from === a.previous.to
          ? fmtDate(a.previous.from)
          : `${fmtDate(a.previous.from)} – ${fmtDate(a.previous.to)}`}
    </>
  );
}

function Kpis({ a, onDrill }: { a: Analytics; onDrill: OnDrill }) {
  const t = a.total;
  const multi = a.days > 1;
  const wd = `${t.working_days} working day${t.working_days === 1 ? "" : "s"}`;
  const open = (title: string, show: AnalyticsShow, focus: Focus, count: number) => (count > 0 ? () => onDrill({ title, show, focus }) : undefined);
  const unmarked = multi ? t.unmarked_students : t.unmarked;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <StatCard label="Eligible students" value={num(t.students)} note={multi ? `with a class in ${wd}` : "with class on this day"} onClick={open("Eligible students", "all", "pct", t.students)} />
      {multi ? (
        <>
          <StatCard label="Present per day (avg)" value={dec(t.avg_present)} note={`${num(t.present)} student-days over ${wd}`} onClick={open("Students with present days", "present", "present", t.present)} />
          <StatCard label="Absent per day (avg)" value={dec(t.avg_absent)} note={`${num(t.absent)} student-days over ${wd}`} onClick={open("Students with absent days", "absent", "absent", t.absent)} />
        </>
      ) : (
        <>
          <StatCard label="Students present" value={num(t.present)} onClick={open("Students present", "present", "present", t.present)} />
          <StatCard label="Students absent" value={num(t.absent)} onClick={open("Students absent", "absent", "absent", t.absent)} />
        </>
      )}
      <StatCard label="Attendance" value={pct(t.pct)} hero note={<Change a={a} />} onClick={open("Attendance by student", "all", "pct", t.students)} />
      <StatCard
        label={multi ? "Students with unmarked days" : "Students unmarked"}
        value={num(unmarked)}
        note={multi ? `${num(t.unmarked)} student-days without a mark` : "no mark yet; not counted as absent"}
        onClick={open(multi ? "Students with unmarked days" : "Students unmarked", "unmarked", "unmarked", unmarked)}
      />
    </div>
  );
}

function SectionCard({ title, subtitle, children, legend }: { title: string; subtitle?: string; children: React.ReactNode; legend?: boolean }) {
  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {legend && <PresentAbsentLegend />}
      </div>
      {children}
    </section>
  );
}

function PresentAbsentLegend() {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-(--viz-present)" /> Present
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-sm bg-(--viz-absent)" /> Absent
      </span>
    </div>
  );
}

/* ---------- hover tooltip ---------- */

type TipState = { x: number; y: number; lines: string[] } | null;

function useTip() {
  const [tip, setTip] = useState<TipState>(null);
  const bind = (lines: string[]) => ({
    onMouseMove: (e: React.MouseEvent) => setTip({ x: e.clientX, y: e.clientY, lines }),
    onMouseLeave: () => setTip(null),
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      setTip({ x: r.left + r.width / 2, y: r.top, lines });
    },
    onBlur: () => setTip(null),
    tabIndex: 0,
    "aria-label": lines.join(", "),
  });
  const view = tip && (
    <div
      role="tooltip"
      className="pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: tip.x, top: tip.y - 10 }}
    >
      <div className="font-semibold text-foreground">{tip.lines[0]}</div>
      {tip.lines.slice(1).map((l) => (
        <div key={l} className="text-muted-foreground tabular-nums">
          {l}
        </div>
      ))}
    </div>
  );
  return { bind, view };
}

const tallyLines = (name: string, t: Tally | DayTally, multi: boolean) => [
  name,
  `Present ${num(t.present)}${multi ? " student-days" : ""}`,
  `Absent ${num(t.absent)}`,
  `Unmarked ${num(t.unmarked)}`,
  `Attendance ${pct(t.pct)}`,
];

/** Present | absent share of the marked days, 2px surface gap between them. */
function SplitBar({ t, label, tip }: { t: Tally; label: string; tip: ReturnType<ReturnType<typeof useTip>["bind"]> }) {
  const marked = t.present + t.absent;
  const p = marked ? (t.present / marked) * 100 : 0;
  return (
    <div className="flex items-center gap-3" {...tip}>
      <div className="flex h-3 flex-1 gap-[2px] overflow-hidden rounded-[4px] bg-muted outline-none" aria-label={label}>
        {t.present > 0 && <div className="h-full rounded-l-[4px] bg-(--viz-present)" style={{ width: `${p}%` }} />}
        {t.absent > 0 && <div className="h-full flex-1 rounded-r-[4px] bg-(--viz-absent)" />}
      </div>
    </div>
  );
}

/* ---------- clickable rows ---------- */

const rowHover = "cursor-pointer transition-colors hover:bg-muted/60";

/** A table row that opens a drill-down; the first cell holds the keyboard button. */
function RowButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={label}
      className="rounded font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

const hallDrill = (h: GroupTally): Drill => ({ title: `${h.degree} · ${hallLabel(h.hall ?? "")}`, show: "all", focus: "pct", degree: h.degree, hall: h.hall ?? "" });

/* ---------- degree ---------- */

function DegreeSection({ a, onDrill }: { a: Analytics; onDrill: OnDrill }) {
  const multi = a.days > 1;
  const tip = useTip();
  const degreeDrill = (name: string, total?: boolean): Drill =>
    total ? { title: "Eligible students", show: "all", focus: "pct" } : { title: `${name} students`, show: "all", focus: "pct", degree: name };
  const rows: { name: string; t: Tally; total?: boolean }[] = [...a.degrees.map((d) => ({ name: d.degree, t: d as Tally })), ...(a.degrees.length > 1 ? [{ name: "Total", t: a.total, total: true }] : [])];
  return (
    <SectionCard title="By degree" subtitle={a.degrees.length > 1 ? `${a.degrees.map((d) => d.degree).join(" vs ")} comparison` : undefined} legend>
      <div className="flex flex-col gap-3">
        {a.degrees.map((d) => (
          <div key={d.degree} className={`-mx-2 grid grid-cols-[3.5rem_1fr_4.5rem] items-center gap-3 rounded-lg px-2 py-1 ${rowHover}`} onClick={() => onDrill({ title: `${d.degree} students`, show: "all", focus: "pct", degree: d.degree })}>
            <span className="text-sm font-semibold text-foreground">{d.degree}</span>
            <SplitBar t={d} label={d.degree} tip={tip.bind(tallyLines(d.degree, d, multi))} />
            <span className="text-right text-sm font-semibold text-foreground tabular-nums">{pct(d.pct)}</span>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-2 pr-3 text-left font-medium">Degree</th>
              <th className="px-2 py-2 text-right font-medium">Students</th>
              <th className="px-2 py-2 text-right font-medium">Present{multi && <span className="block font-normal">student-days</span>}</th>
              <th className="px-2 py-2 text-right font-medium">Absent{multi && <span className="block font-normal">student-days</span>}</th>
              <th className="px-2 py-2 text-right font-medium">Unmarked</th>
              {multi && <th className="px-2 py-2 text-right font-medium">Present / day</th>}
              <th className="py-2 pl-2 text-right font-medium">Attendance</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {rows.map(({ name, t, total }) => (
              <tr
                key={name}
                className={`${total ? "border-t-2 border-border font-semibold" : "border-b border-border/60"} ${t.students ? rowHover : ""}`}
                onClick={t.students ? () => onDrill(degreeDrill(name, total)) : undefined}
              >
                <td className="py-2 pr-3 font-medium text-foreground">
                  {t.students ? (
                    <RowButton label={`Show ${total ? "all" : name} students`} onClick={() => onDrill(degreeDrill(name, total))}>
                      {name}
                    </RowButton>
                  ) : (
                    name
                  )}
                </td>
                <td className="px-2 py-2 text-right">{num(t.students)}</td>
                <td className="px-2 py-2 text-right">{num(t.present)}</td>
                <td className="px-2 py-2 text-right">{num(t.absent)}</td>
                <td className="px-2 py-2 text-right">{num(t.unmarked)}</td>
                {multi && <td className="px-2 py-2 text-right">{dec(t.avg_present)}</td>}
                <td className="py-2 pl-2 text-right font-semibold text-foreground">{pct(t.pct)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {tip.view}
    </SectionCard>
  );
}

/* ---------- insights ---------- */

function InsightsCard({ a }: { a: Analytics }) {
  const i = a.insights;
  const items: { label: string; value: React.ReactNode }[] = [];
  if (i.top_degrees.length) items.push({ label: "Highest attendance degree", value: `${i.top_degrees.join(", ")} · ${pct(i.top_degree_pct)}` });
  if (i.top_halls.length) items.push({ label: "Highest attendance hall", value: `${i.top_halls.join(", ")} · ${pct(i.top_hall_pct)}` });
  if (i.bottom_halls.length) items.push({ label: "Lowest attendance hall", value: `${i.bottom_halls.join(", ")} · ${pct(i.bottom_hall_pct)}` });
  items.push({
    label: a.days === 1 ? "Compared with the previous working day" : a.period === "lastmonth" ? "Compared with the month before" : "Compared with the previous period",
    value: (
      <>
        <Change a={a} />
        {i.prev_pct !== null && <span className="text-muted-foreground"> ({pct(i.prev_pct)})</span>}
      </>
    ),
  });
  items.push({
    label: "Unmarked attendance",
    value: a.total.unmarked_students === 0 ? "Every eligible student is marked" : `${num(a.total.unmarked_students)} student${a.total.unmarked_students === 1 ? "" : "s"} (${num(a.total.unmarked)} student-days)`,
  });
  items.push({ label: "Working days covered", value: `${a.total.working_days} of ${a.days} calendar day${a.days === 1 ? "" : "s"}` });
  return (
    <SectionCard title="Key insights">
      <ul className="flex flex-col divide-y divide-border/70">
        {items.map((it) => (
          <li key={it.label} className="flex flex-col gap-0.5 py-2.5 first:pt-0 last:pb-0">
            <span className="text-xs text-muted-foreground">{it.label}</span>
            <span className="text-sm font-medium text-foreground">{it.value}</span>
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

/* ---------- halls ---------- */

const byDegree = (halls: GroupTally[]) => {
  const m = new Map<string, GroupTally[]>();
  for (const h of halls) m.set(h.degree, [...(m.get(h.degree) ?? []), h]);
  return [...m.entries()];
};

function HallPctChart({ a, onDrill }: { a: Analytics; onDrill: OnDrill }) {
  const multi = a.days > 1;
  const tip = useTip();
  const groups = byDegree(a.halls);
  return (
    <SectionCard title="Attendance % by hall" subtitle="Highest first, within each degree">
      <div className={`grid gap-6 ${groups.length > 1 ? "md:grid-cols-2" : ""}`}>
        {groups.map(([deg, halls]) => (
          <div key={deg} className="flex flex-col gap-2">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{deg}</span>
            {[...halls]
              .sort((x, y) => (y.pct ?? -1) - (x.pct ?? -1))
              .map((h) => (
                <div
                  key={h.hall}
                  role="button"
                  className={`-mx-2 grid grid-cols-[5.5rem_1fr_4.5rem] items-center gap-3 rounded-lg px-2 py-1 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${rowHover}`}
                  {...tip.bind(tallyLines(`${deg} · ${hallLabel(h.hall ?? "")}`, h, multi))}
                  onClick={() => onDrill(hallDrill(h))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onDrill(hallDrill(h));
                    }
                  }}
                >
                  <span className="truncate text-sm text-foreground">{hallLabel(h.hall ?? "")}</span>
                  <div className="h-3 rounded-[4px] bg-muted">
                    <div className="h-full rounded-[4px] bg-(--viz-present)" style={{ width: `${h.pct ?? 0}%` }} />
                  </div>
                  <span className="text-right text-sm font-medium text-foreground tabular-nums">{pct(h.pct)}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
      {tip.view}
    </SectionCard>
  );
}

function HallTable({ a, onDrill }: { a: Analytics; onDrill: OnDrill }) {
  const multi = a.days > 1;
  const tip = useTip();
  return (
    <SectionCard title="Hall-wise attendance" subtitle={multi ? "Present and absent are student-days" : undefined} legend>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="py-2 pr-3 text-left font-medium">Degree</th>
              <th className="px-2 py-2 text-left font-medium">Hall</th>
              <th className="px-2 py-2 text-right font-medium">Students</th>
              <th className="px-2 py-2 text-right font-medium">Present</th>
              <th className="px-2 py-2 text-right font-medium">Absent</th>
              <th className="px-2 py-2 text-right font-medium">Unmarked</th>
              {multi && <th className="px-2 py-2 text-right font-medium">Present / day</th>}
              <th className="hidden w-40 px-3 py-2 text-left font-medium sm:table-cell">Present vs absent</th>
              <th className="py-2 pl-2 text-right font-medium">Attendance</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {byDegree(a.halls).map(([deg, halls]) =>
              halls.map((h, i) => (
                <tr key={deg + h.hall} className={`border-b border-border/60 ${i === 0 ? "border-t border-t-border" : ""} ${rowHover}`} onClick={() => onDrill(hallDrill(h))}>
                  <td className="py-2 pr-3 font-medium text-foreground">{i === 0 ? deg : ""}</td>
                  <td className="px-2 py-2 text-foreground">
                    <RowButton label={`Show ${deg} ${hallLabel(h.hall ?? "")} students`} onClick={() => onDrill(hallDrill(h))}>
                      {hallLabel(h.hall ?? "")}
                    </RowButton>
                  </td>
                  <td className="px-2 py-2 text-right">{num(h.students)}</td>
                  <td className="px-2 py-2 text-right">{num(h.present)}</td>
                  <td className="px-2 py-2 text-right">{num(h.absent)}</td>
                  <td className="px-2 py-2 text-right">{num(h.unmarked)}</td>
                  {multi && <td className="px-2 py-2 text-right">{dec(h.avg_present)}</td>}
                  <td className="hidden px-3 py-2 sm:table-cell">
                    <SplitBar t={h} label={`${deg} ${hallLabel(h.hall ?? "")}`} tip={tip.bind(tallyLines(`${deg} · ${hallLabel(h.hall ?? "")}`, h, multi))} />
                  </td>
                  <td className="py-2 pl-2 text-right font-semibold text-foreground">{pct(h.pct)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
      {tip.view}
    </SectionCard>
  );
}

/* ---------- daily trend ---------- */

function niceMax(n: number) {
  if (n <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(n));
  return Math.ceil(n / step) * step;
}

function DailyTrend({ a }: { a: Analytics }) {
  const tip = useTip();
  const max = niceMax(Math.max(...a.daily.map((d) => d.present + d.absent)));
  const ticks = [0, max / 2, max];
  const showPct = a.daily.length <= 12;
  const every = Math.ceil(a.daily.length / 7); // at most ~7 date labels, so they fit on a phone
  const short = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <SectionCard title="Daily attendance" subtitle="Students present and absent on each working day; % above each bar" legend>
      <div className="flex gap-2">
        <div className="relative w-10 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums" style={{ height: 200 }}>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${100 - (t / max) * 100}%` }}>
              {num(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height: 200 }}>
            {ticks.map((t) => (
              <div key={t} className="absolute inset-x-0 border-t border-border/60" style={{ top: `${100 - (t / max) * 100}%` }} />
            ))}
            <div className="absolute inset-0 flex items-end gap-[3px]">
              {a.daily.map((d) => {
                const h = ((d.present + d.absent) / max) * 100;
                return (
                  <div key={d.date} className="relative flex h-full min-w-0 flex-1 flex-col justify-end outline-none" {...tip.bind(tallyLines(fmtDate(d.date), d, false))}>
                    {showPct && (
                      <span className="absolute inset-x-0 text-center text-[10px] font-medium text-muted-foreground tabular-nums" style={{ bottom: `calc(${h}% + 4px)` }}>
                        {d.pct === null ? "" : `${Math.round(d.pct)}%`}
                      </span>
                    )}
                    <div className="mx-auto flex w-full max-w-10 flex-col gap-[2px]" style={{ height: `${h}%` }}>
                      {d.absent > 0 && <div className="rounded-t-[4px] bg-(--viz-absent)" style={{ flex: d.absent }} />}
                      {d.present > 0 && <div className={`bg-(--viz-present) ${d.absent > 0 ? "" : "rounded-t-[4px]"}`} style={{ flex: d.present }} />}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="mt-1.5 flex gap-[3px] text-[10px] text-muted-foreground">
            {a.daily.map((d, i) => (
              <span key={d.date} className="min-w-0 flex-1 truncate text-center">
                {i % every === 0 ? short(d.date) : ""}
              </span>
            ))}
          </div>
        </div>
      </div>
      {tip.view}
    </SectionCard>
  );
}
