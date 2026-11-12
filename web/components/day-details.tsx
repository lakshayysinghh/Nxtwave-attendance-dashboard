"use client";

import { Popover } from "@base-ui/react/popover";

import { categoryInfo, fmtDate } from "@/components/attendance-ui";
import type { CalendarDay, InternshipListItem, MonthDay, Period } from "@/lib/api";

/**
 * Day details shown when a calendar date is hovered (or tapped on a phone).
 * Every fact comes from the API, which resolves days with the attendance
 * rules; nothing here decides whether a day counts.
 */

const weekdayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" });
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const asDate = (iso: string) => new Date(iso + "T00:00:00Z");

type Kind = MonthDay["kind"] | CalendarDay["kind"];

/** Type names and colours, shared with the calendar tables. */
export const kindInfo: Record<string, { label: string; cls: string; dot: string }> = {
  working: { label: "Working day", cls: "bg-green-50 text-green-800 ring-green-200", dot: "bg-green-500" },
  holiday: { label: "Holiday", cls: "bg-slate-100 text-slate-700 ring-slate-300", dot: "bg-slate-400" },
  exam: { label: "Exam", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  exam_prep: { label: "Exam preparation", cls: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-500" },
  event: { label: "Event", cls: "bg-blue-50 text-blue-800 ring-blue-200", dot: "bg-blue-500" },
  sunday: { label: "Sunday", cls: "bg-slate-50 text-slate-600 ring-slate-200", dot: "bg-slate-300" },
};

/** Where the day's type comes from, or "" for the default rule. */
function scopeText(appliesTo: string) {
  if (appliesTo === "ALL") return "All degrees";
  return appliesTo ? `${appliesTo} only` : "";
}

/** The day's heading: the admin's label, or a plain name for the type. */
function titleOf(kind: Kind, label: string) {
  if (label) return label;
  if (kind === "working") return "Class day";
  if (kind === "sunday") return "Sunday off";
  return (kindInfo[kind] ?? kindInfo.working).label;
}

/** counted is "future" for a date that has not happened yet. */
function Counts({ counted }: { counted: boolean | "future" }) {
  const [dot, text, cls] =
    counted === "future"
      ? ["bg-slate-300", "Future date", "text-slate-500"]
      : counted
        ? ["bg-green-500", "Counts", "text-green-700"]
        : ["bg-slate-300", "Not counted", "text-slate-500"];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 text-xs font-medium ${cls}`}>
      <span className={`size-1.5 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  );
}

/**
 * One resolved day for one degree: the degree name and whether it counts,
 * the title, and one quiet line with the type and where it comes from.
 */
function DayBlock({
  degree,
  kind,
  label,
  appliesTo,
  counted,
  muted,
}: {
  degree: string;
  kind: Kind;
  label: string;
  appliesTo: string;
  counted: boolean | "future";
  muted?: boolean;
}) {
  const info = kindInfo[kind] ?? kindInfo.working;
  const scope = scopeText(appliesTo);
  // The type is worth repeating only when the title is the admin's own label.
  const detail = [label ? info.label : "", scope ? `Applies to: ${scope}` : kind === "working" ? "Default: Monday to Saturday" : ""].filter(Boolean);
  return (
    <section className={`flex flex-col gap-1 rounded-md px-3 py-2.5 ${muted ? "bg-slate-50/60" : "bg-slate-50"}`} aria-label={degree}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">{degree}</span>
        <Counts counted={counted} />
      </div>
      <div className={`flex items-start gap-2 ${muted ? "text-slate-600" : "text-slate-900"}`}>
        <span className={`mt-1.5 size-2 shrink-0 rounded-full ${info.dot}`} aria-hidden />
        <span className="font-medium leading-snug break-words">{titleOf(kind, label)}</span>
      </div>
      {detail.length > 0 && <p className="pl-4 text-xs text-slate-500">{detail.join(" · ")}</p>}
    </section>
  );
}

function Heading({ iso }: { iso: string }) {
  const d = asDate(iso);
  return (
    <header className="flex flex-col">
      <span className="text-xs text-slate-500">{weekdayFmt.format(d)}</span>
      <span className="text-[15px] font-semibold text-slate-900">{dateFmt.format(d)}</span>
    </header>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-[11px] font-medium tracking-wider text-slate-400 uppercase">{title}</h4>
      {children}
    </div>
  );
}

/**
 * A calendar date that opens its details on hover (after a short delay) or
 * on tap. trigger is the date cell; it must be a <button>. The popup is
 * portalled to the page, so calendar containers never clip it.
 */
export function DayPopover({ trigger, children }: { trigger: React.ReactElement; children: React.ReactNode }) {
  return (
    <Popover.Root>
      <Popover.Trigger openOnHover delay={200} closeDelay={80} render={trigger} />
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={8} collisionPadding={8} className="z-50">
          <Popover.Popup className="flex max-h-[min(70vh,30rem)] w-[min(20rem,calc(100vw-1rem))] flex-col gap-3 overflow-y-auto rounded-xl bg-white p-4 text-left text-sm text-slate-700 shadow-lg ring-1 ring-slate-900/5 outline-none">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const exclusionText: Record<string, string> = {
  outside_term: "Outside the semester, so it does not count.",
  before_join: "Before the student joined, so it does not count.",
  after_drop: "After the student was dropped, so it does not count.",
};

const markText = { P: ["Present", "bg-green-500", "text-green-700"], A: ["Absent", "bg-red-500", "text-red-700"] } as const;

/** Details of one day of one student's calendar (student view and the admin student page). */
export function StudentDayDetails({ d, degree, periods, today }: { d: MonthDay; degree: string; periods: Period[]; today: string }) {
  const future = d.date > today;
  const mark = d.counted && !future ? d.status : null;
  const cat = d.category ? categoryInfo[d.category] : null;
  const period = d.category
    ? periods.find((p) => p.kind === d.category && p.state !== "cancelled" && p.start <= d.date && d.date <= p.end)
    : undefined;
  return (
    <>
      <Heading iso={d.date} />
      <DayBlock degree={degree} kind={d.kind} label={d.label} appliesTo={d.applies_to} counted={future ? "future" : d.counted} />
      {d.excluded && d.excluded !== "future" && exclusionText[d.excluded] && <p className="text-xs text-amber-700">{exclusionText[d.excluded]}</p>}
      {((d.counted && !future) || cat) && (
        <Group title="Attendance">
          {d.counted && !future && (
            <div className="flex items-center gap-2">
              {mark ? (
                <>
                  <span className={`size-2 rounded-full ${markText[mark][1]}`} aria-hidden />
                  <span className={`font-medium ${markText[mark][2]}`}>{markText[mark][0]}</span>
                </>
              ) : (
                <span className="text-slate-500">Not marked: left out of the %</span>
              )}
            </div>
          )}
          {cat && (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${cat.dot}`} aria-hidden />
                <span className="font-medium text-slate-800">{cat.label}</span>
                <span className="text-xs text-slate-500">counted as {cat.mark}</span>
              </div>
              {period && (
                <span className="pl-4 text-xs text-slate-500">
                  {fmtDate(period.start)} – {fmtDate(period.end)}
                  {period.kind === "REGISTRATION_PENDING" &&
                    (period.completed_on ? ` · completed by ${fmtDate(period.completed_on)}` : " · not completed yet")}
                </span>
              )}
            </div>
          )}
        </Group>
      )}
    </>
  );
}

const MAX_NAMES = 10;

/**
 * Details of one date on the admin Calendar: one section per degree, with
 * the chosen view first. A degree-specific entry is only ever shown under
 * its own degree.
 */
export function AdminDayDetails({ d, view, interns }: { d: CalendarDay; view: string; interns: InternshipListItem[] }) {
  const mine = d.by_degree.filter((b) => b.degree === view);
  const others = d.by_degree.filter((b) => b.degree !== view);
  const block = (b: CalendarDay["by_degree"][number], muted?: boolean) => (
    <DayBlock key={b.degree} degree={b.degree} kind={b.kind} label={b.label} appliesTo={b.applies_to} counted={b.counted} muted={muted} />
  );
  // Entries that decide no degree's day (one degree's own entry wins over ALL) are listed so nothing saved is hidden.
  const shadowed = d.entries.filter((e) => !d.by_degree.some((b) => b.applies_to === e.applies_to));
  return (
    <>
      <Heading iso={d.date} />
      {!d.in_term && <p className="text-xs text-amber-700">Outside every term: no day counts.</p>}
      {view === "ALL" ? (
        <div className="flex flex-col gap-2">{d.by_degree.map((b) => block(b))}</div>
      ) : (
        <>
          {mine.map((b) => block(b))}
          {others.length > 0 && (
            <Group title="Other degrees">
              <div className="flex flex-col gap-2">{others.map((b) => block(b, true))}</div>
            </Group>
          )}
        </>
      )}

      {shadowed.length > 0 && (
        <Group title="Also saved">
          <ul className="flex flex-col gap-1 text-xs text-slate-600">
            {shadowed.map((e) => (
              <li key={e.applies_to}>
                {scopeText(e.applies_to)}: {(kindInfo[e.day_type] ?? kindInfo.working).label}
                {e.label && ` · ${e.label}`} <span className="text-slate-400">(overridden by the degree&rsquo;s own entry)</span>
              </li>
            ))}
          </ul>
        </Group>
      )}

      {interns.length > 0 && (
        <Group title={`On internship · ${interns.length}`}>
          <ul className="flex flex-col gap-0.5 text-xs text-slate-600">
            {interns.slice(0, MAX_NAMES).map((i) => (
              <li key={i.id} className="truncate">
                {i.name} <span className="text-slate-400">· {i.degree}</span>
              </li>
            ))}
          </ul>
          {interns.length > MAX_NAMES && <p className="text-xs text-slate-400">and {interns.length - MAX_NAMES} more in the Internships table</p>}
        </Group>
      )}
    </>
  );
}
