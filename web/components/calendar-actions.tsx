"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CenteredDialog } from "@/components/ui/overlay";
import { useState } from "react";

import { fmtDate } from "@/components/attendance-ui";
import { inputCls } from "@/components/auth";
import { kindInfo } from "@/components/day-details";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  calendarEntriesApi,
  type AdminRef,
  type CalendarDeletion,
  type CalendarEntryRange,
  type CalendarImpact,
  type DayType,
  type DeletionPreview,
  type DeletionSelector,
  type EntrySource,
  type ImportBatch,
} from "@/lib/api";

/**
 * Calendar entry actions: details and edit, deleting selected entries,
 * resetting imported entries, and the deletion log with restore. Every
 * deletion is previewed by the API (exact entries and attendance impact)
 * before it can be confirmed.
 */

export const LEGACY = "Legacy / Source unavailable";
export const sourceLabel: Record<EntrySource, string> = {
  legacy: LEGACY,
  manual: "Manual entry",
  calendar_import: "Calendar import",
  attendance_import: "Attendance import",
  students_import: "Students import",
};
const timeFmt = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
const istDay = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata" });
export const fmtTime = (iso: string) => `${timeFmt.format(new Date(iso))} IST`;
/** The IST calendar date of a timestamp, as YYYY-MM-DD. */
export const dayOf = (iso: string) => istDay.format(new Date(iso));
export const scopeLabel = (a: string) => (a === "ALL" ? "All degrees" : `${a} only`);
const kindLabel = (k: string) => (k === "sunday" ? "Sunday" : (kindInfo[k] ?? kindInfo.working).label);
export const rangeText = (start: string, end: string) => (start === end ? fmtDate(start) : `${fmtDate(start)} – ${fmtDate(end)}`);
export const keysOf = (rs: CalendarEntryRange[]) => rs.flatMap((r) => r.dates.map((date) => ({ date, applies_to: r.applies_to })));

export function Who({ at, by, unknown }: { at: string | null; by: AdminRef; unknown: string }) {
  if (!at) return <span className="text-muted-foreground">{unknown}</span>;
  return (
    <span className="flex flex-col">
      <span className="whitespace-nowrap">{fmtTime(at)}</span>
      <span className="text-xs text-muted-foreground">{by ? by.name || by.email : "Admin account removed"}</span>
    </span>
  );
}

export function Banner({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return (
    <p
      role={msg.ok ? "status" : "alert"}
      className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}
    >
      {msg.text}
    </p>
  );
}

const Modal = CenteredDialog;

/** What a calendar change does to attendance days. Marks are never changed. */
export function ImpactSummary({ impact }: { impact: CalendarImpact }) {
  const byDegree = (counting: (c: CalendarImpact["changes"][number]) => boolean) => {
    const m: Record<string, number> = {};
    for (const c of impact.changes) if (counting(c)) m[c.degree] = (m[c.degree] ?? 0) + 1;
    return Object.entries(m)
      .map(([d, n]) => `${n} for ${d}`)
      .join(", ");
  };
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-semibold">Effect on attendance</h3>
      {impact.changes.length === 0 ? (
        <p>No attendance day changes: every date is decided the same way afterwards (for example, another entry for the same degree still applies).</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1 pl-5">
          {impact.start_counting > 0 && (
            <li>
              <b>{impact.start_counting}</b> date(s) start counting as class days ({byDegree((c) => c.counting_changes && c.after.counted)}).{" "}
              <b>{impact.marks_start}</b> saved mark(s) on them will count toward percentages. Days with no mark stay out of the %, never counted
              as absent.
            </li>
          )}
          {impact.stop_counting > 0 && (
            <li>
              <b>{impact.stop_counting}</b> date(s) stop counting ({byDegree((c) => c.counting_changes && !c.after.counted)}). Their{" "}
              <b>{impact.marks_stop}</b> saved mark(s) are kept but ignored by percentages.
            </li>
          )}
          {impact.changes.some((c) => !c.counting_changes) && (
            <li>Some dates only change their type or label (future dates, or dates outside a term, never count yet).</li>
          )}
        </ul>
      )}
      {impact.changes.length > 0 && (
        <div className="max-h-56 overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Degree</th>
                <th className="px-2 py-1.5 font-medium">Now</th>
                <th className="px-2 py-1.5 font-medium">After</th>
                <th className="px-2 py-1.5 font-medium">Marks</th>
              </tr>
            </thead>
            <tbody>
              {impact.changes.map((c) => (
                <tr key={c.date + c.degree} className="border-t border-border">
                  <td className="px-2 py-1 whitespace-nowrap">{fmtDate(c.date)}</td>
                  <td className="px-2 py-1">{c.degree}</td>
                  <td className="px-2 py-1">
                    {kindLabel(c.before.kind)}
                    {c.before.label && ` (${c.before.label})`} · {c.before.counted ? "counts" : "not counted"}
                  </td>
                  <td className="px-2 py-1">
                    {kindLabel(c.after.kind)}
                    {c.after.label && ` (${c.after.label})`} · <b>{c.after.counted ? "counts" : "not counted"}</b>
                  </td>
                  <td className="px-2 py-1 tabular-nums">{c.marks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Students, attendance marks, internships and registration-pending periods are never changed. Percentages update as soon as the calendar
        changes.
      </p>
    </div>
  );
}

function PreviewBody({ p }: { p: DeletionPreview }) {
  return (
    <>
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-900">
        <b>
          {p.count} entr{p.count === 1 ? "y" : "ies"}
        </b>{" "}
        on {p.dates.length} date{p.dates.length === 1 ? "" : "s"} ({p.dates.length ? rangeText(p.dates[0], p.dates[p.dates.length - 1]) : "–"}) ·
        degrees: {p.degrees.map((d) => (d === "ALL" ? "All degrees" : d)).join(", ") || "–"} · sections: not applicable (calendar entries apply per
        degree) · types:{" "}
        {Object.entries(p.types)
          .map(([k, n]) => `${kindLabel(k)} ${n}`)
          .join(", ")}
      </div>
      {(p.kept.manual > 0 || p.kept.legacy > 0) && (
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2">
          Kept: {p.kept.manual} manual and {p.kept.legacy} legacy entr{p.kept.manual + p.kept.legacy === 1 ? "y" : "ies"} match these filters but are
          not removed. A reset only removes entries from imports; delete others by selecting them in Manage entries.
        </p>
      )}
      {p.missing > 0 && <p className="text-amber-800">{p.missing} selected entr{p.missing === 1 ? "y no longer exists" : "ies no longer exist"}.</p>}
      <div className="max-h-56 overflow-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-muted text-muted-foreground">
            <tr>
              <th className="px-2 py-1.5 font-medium">Dates</th>
              <th className="px-2 py-1.5 font-medium">Title</th>
              <th className="px-2 py-1.5 font-medium">Type</th>
              <th className="px-2 py-1.5 font-medium">Applies to</th>
              <th className="px-2 py-1.5 font-medium">Source</th>
            </tr>
          </thead>
          <tbody>
            {p.entries.map((e) => (
              <tr key={e.applies_to + e.start} className="border-t border-border align-top">
                <td className="px-2 py-1 whitespace-nowrap">
                  {rangeText(e.start, e.end)}
                  {e.days > 1 && <span className="text-muted-foreground"> · {e.days} days</span>}
                </td>
                <td className="px-2 py-1">{e.label || "No title"}</td>
                <td className="px-2 py-1">{kindLabel(e.day_type)}</td>
                <td className="px-2 py-1 whitespace-nowrap">{scopeLabel(e.applies_to)}</td>
                <td className="px-2 py-1">
                  {sourceLabel[e.source]}
                  {e.batch && <span className="block break-all text-muted-foreground">{e.batch.file_name}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ImpactSummary impact={p.impact} />
    </>
  );
}

const errText = (e: unknown) =>
  e instanceof ApiError && e.status === 409 ? `${e.message}` : e instanceof Error ? e.message : "Something went wrong.";

function useAfterDelete(onDone: (text: string) => void) {
  const qc = useQueryClient();
  return (text: string) => {
    qc.invalidateQueries();
    onDone(text);
  };
}

/** Preview and confirm deleting exactly the given entries (any source). */
export function DeleteEntriesDialog({
  ranges,
  onClose,
  onDone,
}: {
  ranges: CalendarEntryRange[] | null;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const open = ranges !== null && ranges.length > 0;
  const sel: DeletionSelector = { mode: "selected", entries: keysOf(ranges ?? []) };
  const preview = useQuery({
    queryKey: ["delete-preview", JSON.stringify(sel)],
    queryFn: () => calendarEntriesApi.previewDelete(sel),
    enabled: open,
    gcTime: 0,
  });
  const [sure, setSure] = useState(false);
  const done = useAfterDelete(onDone);
  const del = useMutation({
    mutationFn: () => calendarEntriesApi.delete(sel, preview.data!.token, true),
    onSuccess: (r) => {
      done(`Deleted ${r.deleted} calendar entr${r.deleted === 1 ? "y" : "ies"}. They can be restored from the Deletion log.`);
      setSure(false);
      onClose();
    },
  });
  const close = () => {
    setSure(false);
    del.reset();
    onClose();
  };
  const p = preview.data;
  return (
    <Modal open={open} onClose={close} title="Delete calendar entries">
      {preview.isPending && <p className="text-muted-foreground">Checking what will be deleted…</p>}
      {preview.error && <Banner msg={{ ok: false, text: errText(preview.error) }} />}
      {p && (
        <>
          <PreviewBody p={p} />
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            <span>I have checked these entries and want to delete them. They are archived and can be restored.</span>
          </label>
          {del.error && (
            <div className="flex flex-wrap items-center gap-2">
              <Banner msg={{ ok: false, text: errText(del.error) }} />
              <Button size="sm" variant="outline" onClick={() => (del.reset(), preview.refetch())}>
                Check again
              </Button>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button className="bg-red-700 text-white hover:bg-red-800" disabled={!sure || p.count === 0 || del.isPending} onClick={() => del.mutate()}>
              {del.isPending ? "Deleting…" : `Delete ${p.count} entr${p.count === 1 ? "y" : "ies"}`}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

const DEGREES = ["ALL", "BITS", "CDU"];
const TYPES: DayType[] = ["holiday", "exam", "exam_prep", "event", "working"];

function toggle<T>(xs: T[], x: T) {
  return xs.includes(x) ? xs.filter((v) => v !== x) : [...xs, x];
}

/**
 * Owner only: remove entries that came from sheet imports, narrowed by
 * uploads, degrees, types and dates. Manual and legacy entries never match.
 */
export function ResetImportedDialog({
  open,
  initialBatch,
  batches,
  onClose,
  onDone,
}: {
  open: boolean;
  initialBatch?: number;
  batches: ImportBatch[];
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [ids, setIds] = useState<number[]>(initialBatch ? [initialBatch] : []);
  const [degrees, setDegrees] = useState<string[]>([]);
  const [types, setTypes] = useState<DayType[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [phrase, setPhrase] = useState("");
  const sel: DeletionSelector = {
    mode: "imported",
    ...(ids.length ? { batch_ids: ids } : {}),
    ...(degrees.length ? { degrees } : {}),
    ...(types.length ? { types } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
  const preview = useMutation({ mutationFn: () => calendarEntriesApi.previewDelete(sel) });
  const done = useAfterDelete(onDone);
  const reset = useMutation({
    mutationFn: () => calendarEntriesApi.delete(sel, preview.data!.token, phrase),
    onSuccess: (r) => {
      done(`Reset: removed ${r.deleted} imported calendar entr${r.deleted === 1 ? "y" : "ies"}. They can be restored from the Deletion log.`);
      close();
    },
  });
  const changed = () => {
    preview.reset();
    reset.reset();
    setPhrase("");
  };
  function close() {
    changed();
    onClose();
  }
  const p = preview.data;
  const want = p ? `RESET ${p.count}` : "";
  const chips = (label: string, on: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      aria-pressed={on}
      onClick={() => (onClick(), changed())}
      className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${on ? "bg-primary text-primary-foreground ring-primary" : "bg-white ring-input hover:bg-muted"}`}
    >
      {label}
    </button>
  );
  return (
    <Modal open={open} onClose={close} title="Reset imported calendar entries">
      <p>
        Removes calendar entries that came from <b>sheet imports</b>, so you can rebuild the calendar from correct data.{" "}
        <b>Manual and legacy entries are never removed here</b>, and students, attendance marks, internships and registration-pending periods are
        never touched. Leave a filter empty to include everything.
      </p>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Uploads</span>
        {batches.length === 0 ? (
          <span className="text-xs text-muted-foreground">No uploads are recorded yet.</span>
        ) : (
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border border-border p-2">
            {batches.map((b) => (
              <label key={b.id} className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={ids.includes(b.id)} onChange={() => (setIds(toggle(ids, b.id)), changed())} />
                <span className="break-all">
                  #{b.id} · {b.file_name} · {fmtTime(b.uploaded_at)} · {b.current_entries} entr{b.current_entries === 1 ? "y" : "ies"} now
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Degrees (Applies to)</span>
        <div className="flex flex-wrap gap-1.5">{DEGREES.map((d) => chips(scopeLabel(d), degrees.includes(d), () => setDegrees(toggle(degrees, d))))}</div>
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Types</span>
        <div className="flex flex-wrap gap-1.5">{TYPES.map((k) => chips(kindLabel(k), types.includes(k), () => setTypes(toggle(types, k))))}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          From
          <input type="date" className={inputCls} value={from} onChange={(e) => (setFrom(e.target.value), changed())} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
          To
          <input type="date" className={inputCls} value={to} onChange={(e) => (setTo(e.target.value), changed())} />
        </label>
      </div>
      {!p && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => preview.mutate()} disabled={preview.isPending}>
            {preview.isPending ? "Checking…" : "Preview what will be removed"}
          </Button>
        </div>
      )}
      {preview.error && <Banner msg={{ ok: false, text: errText(preview.error) }} />}
      {p && p.count === 0 && (
        <>
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2">No imported entries match these filters.</p>
          {(p.kept.manual > 0 || p.kept.legacy > 0) && (
            <p>
              {p.kept.manual} manual and {p.kept.legacy} legacy entries match but are never removed by a reset. To delete them, select them in Manage
              entries.
            </p>
          )}
        </>
      )}
      {p && p.count > 0 && (
        <>
          <PreviewBody p={p} />
          <label className="flex flex-col gap-1 text-sm">
            <span>
              Type <b className="font-mono">{want}</b> to confirm.
            </span>
            <input className={`${inputCls} w-48 font-mono uppercase`} value={phrase} onChange={(e) => setPhrase(e.target.value)} aria-label={`Type ${want} to confirm`} placeholder={want} />
          </label>
          {reset.error && (
            <div className="flex flex-wrap items-center gap-2">
              <Banner msg={{ ok: false, text: errText(reset.error) }} />
              <Button size="sm" variant="outline" onClick={() => (reset.reset(), preview.mutate())}>
                Check again
              </Button>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close}>
              Cancel
            </Button>
            <Button
              className="bg-red-700 text-white hover:bg-red-800"
              disabled={phrase.trim().toUpperCase() !== want || reset.isPending}
              onClick={() => reset.mutate()}
            >
              {reset.isPending ? "Removing…" : `Remove ${p.count} imported entr${p.count === 1 ? "y" : "ies"}`}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}

/** Everything about one entry range, with an in-place edit and delete. */
export function EntryDetailsDialog({
  entry,
  batch,
  onClose,
  onDelete,
  onDone,
}: {
  entry: CalendarEntryRange | null;
  batch?: ImportBatch;
  onClose: () => void;
  onDelete: (e: CalendarEntryRange) => void;
  onDone: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dayType, setDayType] = useState<DayType>("holiday");
  const [counts, setCounts] = useState(true);
  const [label, setLabel] = useState("");
  const done = useAfterDelete(onDone);
  const save = useMutation({
    mutationFn: () =>
      calendarEntriesApi.edit({ entries: keysOf([entry!]), token: entry!.token, day_type: dayType, counts: dayType === "event" ? counts : undefined, label }),
    onSuccess: (r) => {
      const i = r.impact;
      const effect = i.start_counting || i.stop_counting ? ` ${i.start_counting} date(s) now count and ${i.stop_counting} stop counting.` : "";
      done(`Saved ${r.updated} date(s); the entry is now a manual entry.${effect}`);
      close();
    },
  });
  function close() {
    setEditing(false);
    save.reset();
    onClose();
  }
  const startEdit = () => {
    if (!entry) return;
    setDayType(entry.day_type);
    setCounts(entry.counts);
    setLabel(entry.label);
    setEditing(true);
  };
  const e = entry;
  const row = (k: string, v: React.ReactNode) => (
    <div className="grid grid-cols-[9rem_1fr] gap-2 border-t border-border py-1.5 first:border-t-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="min-w-0 break-words">{v}</dd>
    </div>
  );
  return (
    <Modal open={e !== null} onClose={close} title="Calendar entry">
      {e && (
        <>
          <dl>
            {row("Title", e.label || <span className="text-muted-foreground">No title</span>)}
            {row("Type", `${kindLabel(e.day_type)}${e.day_type === "event" ? (e.counts ? " · counts toward attendance" : " · not counted") : ""}`)}
            {row("Dates", `${rangeText(e.start, e.end)} · ${e.days} day${e.days === 1 ? "" : "s"}${e.dates.length > 1 ? ` (${e.dates.map(fmtDate).join(", ")})` : ""}`)}
            {row("Applies to", scopeLabel(e.applies_to))}
            {row("Sections", "Not applicable: calendar entries apply per degree")}
            {row("Source", sourceLabel[e.source])}
            {row(
              "Import",
              e.batch ? (
                <>
                  {e.batch.file_name} · upload #{e.batch.id}
                  {batch && ` · uploaded ${fmtTime(batch.uploaded_at)} by ${batch.uploaded_by?.name || batch.uploaded_by?.email || "a removed admin"}`}
                </>
              ) : e.source === "legacy" ? (
                "Unknown: saved before sources were recorded"
              ) : (
                "None"
              ),
            )}
            {row("Created", <Who at={e.created_at} by={e.created_by} unknown="Unknown (legacy)" />)}
            {row("Last updated", <Who at={e.updated_at} by={e.updated_by} unknown="Unknown (legacy)" />)}
          </dl>
          {!editing ? (
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" className="text-red-700 hover:text-red-800" onClick={() => onDelete(e)}>
                Delete…
              </Button>
              <Button onClick={startEdit}>Edit</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-border p-3">
              <label className="flex flex-col gap-1 text-xs font-medium">
                Day type
                <select className={inputCls} value={dayType} onChange={(ev) => setDayType(ev.target.value as DayType)}>
                  <option value="holiday">Holiday (not counted)</option>
                  <option value="exam">Exam (not counted)</option>
                  <option value="exam_prep">Exam preparation (not counted)</option>
                  <option value="event">Event</option>
                  <option value="working">Working (counted)</option>
                </select>
              </label>
              {dayType === "event" && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={counts} onChange={(ev) => setCounts(ev.target.checked)} />
                  Counts toward attendance
                </label>
              )}
              <label className="flex flex-col gap-1 text-xs font-medium">
                Label
                <input className={inputCls} value={label} maxLength={100} onChange={(ev) => setLabel(ev.target.value)} />
              </label>
              <p className="text-xs text-muted-foreground">
                Saving changes all {e.days} date(s) of this entry for {scopeLabel(e.applies_to)}. It then counts as a <b>manual entry</b>, so a reset
                of imported entries will not remove it. To change the dates or the degree, delete it and add it again in Month view.
              </p>
              {save.error && <Banner msg={{ ok: false, text: errText(save.error) }} />}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <Button disabled={save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Saving…" : "Save changes"}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

function DeletionRow({ d, isOwner, onMsg }: { d: CalendarDeletion; isOwner: boolean; onMsg: (m: { ok: boolean; text: string }) => void }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const entries = useQuery({ queryKey: ["deletion", d.id], queryFn: () => calendarEntriesApi.deletion(d.id), enabled: open });
  const restore = useMutation({
    mutationFn: () => calendarEntriesApi.restore(d.id),
    onSuccess: (r) => {
      qc.invalidateQueries();
      onMsg({
        ok: true,
        text: `Restored ${r.restored} entr${r.restored === 1 ? "y" : "ies"}.${r.skipped ? ` ${r.skipped} not restored: a newer entry now uses that date and degree.` : ""}`,
      });
    },
    onError: (e: Error) => onMsg({ ok: false, text: e.message }),
  });
  const dates = d.criteria.dates ?? [];
  const allBack = d.restored_entries >= d.entry_count;
  const canRestore = !allBack && (d.kind === "selected" || isOwner);
  return (
    <li className="flex flex-col gap-2 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">
            {d.kind === "imported" ? "Reset of imported entries" : "Deleted selected entries"} · {d.entry_count} entr{d.entry_count === 1 ? "y" : "ies"}
          </div>
          <div className="text-xs text-muted-foreground">
            {fmtTime(d.deleted_at)} by {d.deleted_by?.name || d.deleted_by?.email || "a removed admin"}
            {dates.length > 0 && <> · {rangeText(dates[0], dates[dates.length - 1])}</>}
            {d.criteria.degrees?.length ? <> · {d.criteria.degrees.map((x) => (x === "ALL" ? "All" : x)).join(", ")}</> : null}
          </div>
          {d.restored_entries > 0 && (
            <div className="text-xs text-green-800">
              Restored {d.restored_entries} of {d.entry_count}
              {d.restored_at && <> · last {fmtTime(d.restored_at)} by {d.restored_by?.name || d.restored_by?.email || "a removed admin"}</>}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide entries" : "Show entries"}
          </Button>
          {canRestore && (
            <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate()}>
              {restore.isPending ? "Restoring…" : "Restore"}
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[560px] text-left text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 font-medium">Date</th>
                <th className="px-2 py-1.5 font-medium">Title</th>
                <th className="px-2 py-1.5 font-medium">Type</th>
                <th className="px-2 py-1.5 font-medium">Applies to</th>
                <th className="px-2 py-1.5 font-medium">Source</th>
                <th className="px-2 py-1.5 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {(entries.data?.entries ?? []).map((e) => (
                <tr key={e.date + e.applies_to} className="border-t border-border">
                  <td className="px-2 py-1 whitespace-nowrap">{fmtDate(e.date)}</td>
                  <td className="px-2 py-1">{e.label || "No title"}</td>
                  <td className="px-2 py-1">{kindLabel(e.day_type)}</td>
                  <td className="px-2 py-1">{scopeLabel(e.applies_to)}</td>
                  <td className="px-2 py-1">
                    {sourceLabel[e.source]}
                    {e.file_name && <span className="block break-all text-muted-foreground">{e.file_name}</span>}
                  </td>
                  <td className="px-2 py-1">{e.restored ? "Restored" : "Deleted"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
  );
}

/** Every deletion and reset: who, when, what; with restore. */
export function DeletionLogCard({ isOwner }: { isOwner: boolean }) {
  const log = useQuery({ queryKey: ["calendar-deletions"], queryFn: calendarEntriesApi.deletions });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const items = log.data?.deletions ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Deletion log</CardTitle>
        <CardDescription>
          Every deletion and reset of calendar entries, with who did it and exactly what was removed. <b>Restore</b> puts entries back with their
          original details, except where a newer entry now uses the same date and degree (that one is kept).
          {!isOwner && " Restoring a reset of imported entries is for the Owner."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Banner msg={msg} />
        {log.error && <Banner msg={{ ok: false, text: log.error.message }} />}
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((d) => (
            <DeletionRow key={d.id} d={d} isOwner={isOwner} onMsg={setMsg} />
          ))}
          {log.isSuccess && items.length === 0 && <li className="px-3 py-4 text-sm text-muted-foreground">No calendar entries have been deleted.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}
