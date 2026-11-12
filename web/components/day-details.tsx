"use client";

import { Popover } from "@base-ui/react/popover";

import { categoryInfo, fmtDate } from "@/components/attendance-ui";
import type { CalendarDay, InternshipListItem, MonthDay, Period } from "@/lib/api";

/**
 * Day details shown when a calendar date is hovered (or tapped on a phone).
 * Every fact comes from the API, which resolves days with the attendance
 * rules; nothing here decides whether a day counts.
 */

const longDate = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const fmtLong = (iso: string) => longDate.format(new Date(iso + "T00:00:00Z"));

type Kind = MonthDay["kind"] | CalendarDay["kind"];

export const kindInfo: Record<string, { label: string; cls: string }> = {
  working: { label: "Working day", cls: "bg-green-50 text-green-800 ring-green-200" },
  holiday: { label: "Holiday", cls: "bg-slate-100 text-slate-700 ring-slate-300" },
  exam: { label: "Exam", cls: "bg-amber-50 text-amber-800 ring-amber-200" },
  exam_prep: { label: "Exam preparation", cls: "bg-rose-50 text-rose-800 ring-rose-200" },
  event: { label: "Event", cls: "bg-blue-50 text-blue-800 ring-blue-200" },
  sunday: { label: "Sunday", cls: "bg-slate-50 text-slate-600 ring-slate-200" },
};

/** "All degrees", "CDU only", or the default rule. */
function scopeText(appliesTo: string, kind: Kind) {
  if (appliesTo === "ALL") return "All degrees";
  if (appliesTo) return `${appliesTo} only`;
  return kind === "sunday" ? "Every Sunday (default)" : "Default: Monday to Saturday are class days";
}

function Chip({ cls, children }: { cls: string; children: React.ReactNode }) {
  return <span className={`inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${cls}`}>{children}</span>;
}

/** counted is "future" for a date that has not happened yet. */
function CountsChip({ counted }: { counted: boolean | "future" }) {
  if (counted === "future") return <Chip cls="bg-slate-50 text-slate-600 ring-slate-200">Future date</Chip>;
  return counted ? (
    <Chip cls="bg-green-50 text-green-800 ring-green-200">Counts toward attendance</Chip>
  ) : (
    <Chip cls="bg-slate-100 text-slate-600 ring-slate-200">Not counted</Chip>
  );
}

/** One resolved day: type, title (the admin's label), scope and whether it counts. */
function DayLine({
  kind,
  label,
  appliesTo,
  counted,
  degree,
}: {
  kind: Kind;
  label: string;
  appliesTo: string;
  counted: boolean | "future";
  degree?: string;
}) {
  const info = kindInfo[kind] ?? kindInfo.working;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {degree && <Chip cls="bg-primary/10 text-primary ring-primary/20">{degree}</Chip>}
        <Chip cls={info.cls}>{info.label}</Chip>
        <CountsChip counted={counted} />
      </div>
      <div className="font-medium break-words">{label || (kind === "working" ? "Normal working day" : kind === "sunday" ? "Sunday: no classes" : info.label)}</div>
      <div className="text-xs text-muted-foreground">Applies to: {scopeText(appliesTo, kind)}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-2 first:border-t-0 first:pt-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</div>
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
        <Popover.Positioner side="top" sideOffset={6} collisionPadding={8} className="z-50">
          <Popover.Popup className="flex max-h-[min(70vh,28rem)] w-80 max-w-[calc(100vw-1rem)] flex-col gap-2 overflow-y-auto rounded-lg bg-white p-3 text-left text-sm text-foreground shadow-lg ring-1 ring-foreground/10 outline-none">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const exclusionText: Record<string, string> = {
  future: "This date is in the future, so it does not count yet.",
  outside_term: "Outside the semester: days between terms never count.",
  before_join: "Before the student joined: not counted.",
  after_drop: "After the student was dropped: not counted.",
};

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
      <div className="font-semibold">{fmtLong(d.date)}</div>
      <Section title={`Calendar for ${degree} students`}>
        <DayLine kind={d.kind} label={d.label} appliesTo={d.applies_to} counted={future ? "future" : d.counted} />
        {d.excluded && d.excluded !== "future" && <p className="text-xs text-amber-800">{exclusionText[d.excluded] ?? "Not counted."}</p>}
      </Section>
      {(d.counted || cat) && (
        <Section title="Attendance">
          {d.counted && !future && (
            <div>
              Mark:{" "}
              <b className={mark === "P" ? "text-green-700" : mark === "A" ? "text-red-700" : "text-muted-foreground"}>
                {mark === "P" ? "Present" : mark === "A" ? "Absent" : "Not marked (left out of the %)"}
              </b>
            </div>
          )}
          {cat && (
            <div className="flex flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <Chip cls={cat.cls}>{cat.label}</Chip>
                <span className="text-xs">counted as {cat.mark}</span>
              </div>
              {period && (
                <span className="text-xs text-muted-foreground">
                  Period: {fmtDate(period.start)} – {fmtDate(period.end)}
                  {period.kind === "REGISTRATION_PENDING" &&
                    (period.completed_on ? ` · completed by ${fmtDate(period.completed_on)}` : " · not completed yet")}
                </span>
              )}
            </div>
          )}
        </Section>
      )}
    </>
  );
}

const MAX_NAMES = 10;

/**
 * Details of one date on the admin Calendar. The chosen view is shown first;
 * every other degree is listed with its own result, so a degree-specific
 * entry is never shown as applying to another degree.
 */
export function AdminDayDetails({ d, view, interns }: { d: CalendarDay; view: string; interns: InternshipListItem[] }) {
  const mine = d.by_degree.find((b) => b.degree === view);
  const others = d.by_degree.filter((b) => b.degree !== view);
  return (
    <>
      <div className="font-semibold">{fmtLong(d.date)}</div>
      {!d.in_term && <p className="text-xs text-amber-800">Outside every term: no day counts.</p>}

      {view === "ALL" ? (
        <Section title="By degree">
          {d.by_degree.map((b) => (
            <DayLine key={b.degree} degree={b.degree} kind={b.kind} label={b.label} appliesTo={b.applies_to} counted={b.counted} />
          ))}
        </Section>
      ) : (
        <>
          {mine && (
            <Section title={`For ${view} students`}>
              <DayLine kind={mine.kind} label={mine.label} appliesTo={mine.applies_to} counted={mine.counted} />
            </Section>
          )}
          {others.length > 0 && (
            <Section title="Other degrees (not for this view)">
              {others.map((b) => (
                <DayLine key={b.degree} degree={b.degree} kind={b.kind} label={b.label} appliesTo={b.applies_to} counted={b.counted} />
              ))}
            </Section>
          )}
        </>
      )}

      <Section title={`Saved calendar entries (${d.entries.length})`}>
        {d.entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">None: the default rule applies.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {d.entries.map((e) => (
              <li key={e.applies_to} className="flex flex-col gap-0.5">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Chip cls="bg-primary/10 text-primary ring-primary/20">{e.applies_to === "ALL" ? "All degrees" : `${e.applies_to} only`}</Chip>
                  <Chip cls={(kindInfo[e.day_type] ?? kindInfo.working).cls}>{(kindInfo[e.day_type] ?? kindInfo.working).label}</Chip>
                  {e.day_type === "event" && <CountsChip counted={e.counts} />}
                </div>
                {e.label && <span className="break-words">{e.label}</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {interns.length > 0 && (
        <Section title={`On internship (${interns.length})`}>
          <ul className="flex flex-col gap-0.5 text-xs">
            {interns.slice(0, MAX_NAMES).map((i) => (
              <li key={i.id}>
                {i.name} <span className="font-mono text-muted-foreground">{i.niat_id}</span> · {i.degree}
              </li>
            ))}
          </ul>
          {interns.length > MAX_NAMES && (
            <p className="text-xs text-muted-foreground">and {interns.length - MAX_NAMES} more: see the Internships table below the calendar.</p>
          )}
        </Section>
      )}
    </>
  );
}
