"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useCurrentAdmin } from "@/components/admin-shell";
import { fmtDate } from "@/components/attendance-ui";
import { inputCls } from "@/components/auth";
import {
  Banner,
  DeleteEntriesDialog,
  EntryDetailsDialog,
  LEGACY,
  ResetImportedDialog,
  Who,
  dayOf,
  fmtTime,
  scopeLabel,
  sourceLabel,
} from "@/components/calendar-actions";
import { kindInfo } from "@/components/day-details";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { calendarEntriesApi, type CalendarEntryRange, type ImportBatch } from "@/lib/api";

/**
 * Calendar entries with where they came from, and the uploads that wrote
 * them. Entries can be opened, edited, selected and deleted; the Owner can
 * reset imported entries. Every deletion is previewed by the API first.
 */

const batchKindLabel: Record<string, string> = {
  calendar: "Calendar import",
  attendance: "Attendance import: dates with no column",
  students: "Students import: dates with no column",
};

function Filter({ label, wide, children }: { label: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 text-xs font-medium text-muted-foreground ${wide ? "sm:col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}

const emptyFilters = { q: "", degree: "", type: "", source: "", from: "", to: "", changed: "updated" as "created" | "updated", changedFrom: "", changedTo: "" };

/** Every saved calendar entry, grouped into date ranges, with filters. */
export function CalendarEntriesCard({ batch, onBatch }: { batch: string; onBatch: (id: string) => void }) {
  const entries = useQuery({ queryKey: ["calendar-entries"], queryFn: calendarEntriesApi.list });
  const history = useQuery({ queryKey: ["import-history"], queryFn: calendarEntriesApi.history });
  const [f, setF] = useState(emptyFilters);
  const isOwner = useCurrentAdmin().role === "owner";
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<CalendarEntryRange | null>(null);
  const [deleting, setDeleting] = useState<CalendarEntryRange[] | null>(null);
  const [resetting, setResetting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const keyOf = (e: CalendarEntryRange) => `${e.applies_to}|${e.start}`;
  const done = (text: string) => {
    setMsg({ ok: true, text });
    setSelected(new Set());
    setDetails(null);
  };
  const set = (k: keyof typeof emptyFilters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  const all = entries.data?.entries ?? [];
  const degrees = [...new Set(all.map((e) => e.applies_to))].sort();
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = all.filter((e) => {
    if (f.degree && e.applies_to !== f.degree) return false;
    if (f.type && e.day_type !== f.type) return false;
    if (f.source === "imported" ? !e.source.endsWith("_import") : f.source && e.source !== f.source) return false;
    if (batch && String(e.batch?.id ?? "") !== batch) return false;
    if (f.from && e.end < f.from) return false;
    if (f.to && e.start > f.to) return false;
    const at = f.changed === "created" ? e.created_at : e.updated_at;
    if ((f.changedFrom || f.changedTo) && !at) return false;
    if (at && f.changedFrom && dayOf(at) < f.changedFrom) return false;
    if (at && f.changedTo && dayOf(at) > f.changedTo) return false;
    const text = [e.label, e.batch?.file_name, e.created_by?.name, e.updated_by?.name, sourceLabel[e.source]].join(" ").toLowerCase();
    return words.every((w) => text.includes(w));
  });
  const filtered = JSON.stringify(f) !== JSON.stringify(emptyFilters) || batch !== "";
  const days = rows.reduce((n, e) => n + e.days, 0);
  const picked = all.filter((e) => selected.has(keyOf(e)));
  const allShown = rows.length > 0 && rows.every((e) => selected.has(keyOf(e)));
  const toggleRow = (e: CalendarEntryRange) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(keyOf(e))) next.delete(keyOf(e));
      else next.add(keyOf(e));
      return next;
    });
  const toggleShown = () =>
    setSelected((cur) => {
      const next = new Set(cur);
      for (const e of rows) {
        if (allShown) next.delete(keyOf(e));
        else next.add(keyOf(e));
      }
      return next;
    });
  const batches = history.data?.batches ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Manage calendar entries</CardTitle>
        <CardDescription>
          Every saved holiday, exam, exam preparation, event and working-day entry, with where it came from. Consecutive days saved together are
          shown as one range. Click an entry&rsquo;s title for its details, to edit or delete it; tick entries to delete several at once.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Filter label="Search">
            <input className={inputCls} value={f.q} onChange={set("q")} placeholder="Title, file name or admin" aria-label="Search entries" />
          </Filter>
          <Filter label="Degree">
            <select className={inputCls} value={f.degree} onChange={set("degree")}>
              <option value="">All scopes</option>
              {degrees.map((d) => (
                <option key={d} value={d}>
                  {scopeLabel(d)}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Type">
            <select className={inputCls} value={f.type} onChange={set("type")}>
              <option value="">All types</option>
              {(["holiday", "exam", "exam_prep", "event", "working"] as const).map((k) => (
                <option key={k} value={k}>
                  {kindInfo[k].label}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Source">
            <select className={inputCls} value={f.source} onChange={set("source")}>
              <option value="">All sources</option>
              <option value="manual">Manual entry</option>
              <option value="imported">Imported (any sheet)</option>
              <option value="calendar_import">Calendar import</option>
              <option value="attendance_import">Attendance import</option>
              <option value="students_import">Students import</option>
              <option value="legacy">{LEGACY}</option>
            </select>
          </Filter>
          <Filter label="Import batch">
            <select className={inputCls} value={batch} onChange={(e) => onBatch(e.target.value)}>
              <option value="">All uploads</option>
              {(history.data?.batches ?? []).map((b) => (
                <option key={b.id} value={String(b.id)}>
                  #{b.id} · {b.file_name} · {fmtTime(b.uploaded_at)}
                </option>
              ))}
            </select>
          </Filter>
          <Filter label="Entry dates from">
            <input type="date" className={inputCls} value={f.from} onChange={set("from")} />
          </Filter>
          <Filter label="Entry dates to">
            <input type="date" className={inputCls} value={f.to} onChange={set("to")} />
          </Filter>
          <Filter label="Saved on (IST)" wide>
            <div className="grid grid-cols-[7rem_1fr_1fr] gap-1">
              <select className={inputCls} value={f.changed} onChange={set("changed")} aria-label="Created or last updated">
                <option value="updated">Updated</option>
                <option value="created">Created</option>
              </select>
              <input type="date" className={inputCls} value={f.changedFrom} onChange={set("changedFrom")} aria-label="Saved from" />
              <input type="date" className={inputCls} value={f.changedTo} onChange={set("changedTo")} aria-label="Saved to" />
            </div>
          </Filter>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Showing {rows.length} of {all.length} entr{all.length === 1 ? "y" : "ies"} ({days} day{days === 1 ? "" : "s"})
            {batch && <> · upload #{batch}</>}. Entries apply per degree; sections are not supported. Internships are not calendar entries: see
            the Internships table in Month view.
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!filtered}
            onClick={() => {
              setF(emptyFilters);
              onBatch("");
            }}
          >
            Clear filters
          </Button>
        </div>

        <Banner msg={msg} />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="bg-red-700 text-white hover:bg-red-800"
            disabled={picked.length === 0}
            onClick={() => {
              setMsg(null);
              setDeleting(picked);
            }}
          >
            Delete selected ({picked.reduce((n, e) => n + e.days, 0)})
          </Button>
          {picked.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setSelected(new Set())}>
              Clear selection
            </Button>
          )}
          {isOwner && (
            <Button
              size="sm"
              variant="outline"
              className="sm:ml-auto"
              onClick={() => {
                setMsg(null);
                setResetting(true);
              }}
            >
              Reset imported entries…
            </Button>
          )}
        </div>
        {entries.error && <p className="text-sm text-red-700">{entries.error.message}</p>}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[960px] text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" aria-label="Select all shown entries" checked={allShown} onChange={toggleShown} disabled={rows.length === 0} />
                </th>
                <th className="px-3 py-2 font-medium">Dates</th>
                <th className="px-3 py-2 font-medium">Title</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Applies to</th>
                <th className="px-3 py-2 font-medium">Source</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Last updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <EntryRow key={keyOf(e)} e={e} checked={selected.has(keyOf(e))} onCheck={() => toggleRow(e)} onOpen={() => setDetails(e)} />
              ))}
            </tbody>
          </table>
          {entries.isSuccess && rows.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">{all.length ? "No entries match these filters." : "No calendar entries saved yet."}</p>
          )}
          {entries.isPending && <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>}
        </div>
      </CardContent>
      <EntryDetailsDialog
        entry={details}
        batch={batches.find((b) => b.id === details?.batch?.id)}
        onClose={() => setDetails(null)}
        onDelete={(e) => {
          setDetails(null);
          setDeleting([e]);
        }}
        onDone={done}
      />
      <DeleteEntriesDialog ranges={deleting} onClose={() => setDeleting(null)} onDone={done} />
      {isOwner && resetting && <ResetImportedDialog open batches={batches} onClose={() => setResetting(false)} onDone={done} />}
    </Card>
  );
}

function EntryRow({ e, checked, onCheck, onOpen }: { e: CalendarEntryRange; checked: boolean; onCheck: () => void; onOpen: () => void }) {
  const info = kindInfo[e.day_type] ?? kindInfo.working;
  const span = Math.round((Date.parse(e.end) - Date.parse(e.start)) / 86_400_000) + 1;
  return (
    <tr className={`border-t border-border align-top ${checked ? "bg-red-50/40" : ""}`}>
      <td className="px-3 py-2">
        <input type="checkbox" aria-label={`Select ${e.label || "entry"} ${e.start} ${e.applies_to}`} checked={checked} onChange={onCheck} />
      </td>
      <td className="px-3 py-2">
        <div className="whitespace-nowrap">{e.start === e.end ? fmtDate(e.start) : `${fmtDate(e.start)} – ${fmtDate(e.end)}`}</div>
        <div className="text-xs text-muted-foreground">
          {e.days} day{e.days === 1 ? "" : "s"}
          {span > e.days && " (Sundays not included)"}
        </div>
      </td>
      <td className="px-3 py-2 break-words">
        <button type="button" onClick={onOpen} className="text-left font-medium text-primary hover:underline">
          {e.label || "No title"}
        </button>
      </td>
      <td className="px-3 py-2">
        <span className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${info.cls}`}>{info.label}</span>
        {e.day_type === "event" && <div className="mt-0.5 text-xs text-muted-foreground">{e.counts ? "Counts" : "Not counted"}</div>}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">{scopeLabel(e.applies_to)}</td>
      <td className="px-3 py-2">
        <div className={e.source === "legacy" ? "text-muted-foreground" : ""}>{sourceLabel[e.source]}</div>
        {e.batch && (
          <div className="text-xs text-muted-foreground">
            <span className="break-all">{e.batch.file_name}</span> · upload #{e.batch.id}
          </div>
        )}
      </td>
      <td className="px-3 py-2">
        <Who at={e.created_at} by={e.created_by} unknown={e.source === "legacy" || !e.updated_at ? "Unknown (legacy)" : "Unknown (saved before tracking)"} />
      </td>
      <td className="px-3 py-2">
        <Who at={e.updated_at} by={e.updated_by} unknown="Unknown (legacy)" />
      </td>
    </tr>
  );
}

function batchStatus(b: ImportBatch) {
  const changed = b.summary.created + b.summary.updated;
  if (b.status !== "committed") return b.status;
  const base = changed ? "Saved" : "No changes";
  return b.summary.skipped ? `${base}, ${b.summary.skipped} row${b.summary.skipped === 1 ? "" : "s"} skipped (errors)` : base;
}

/** Uploads that wrote calendar entries, newest first. */
export function ImportHistoryCard({ onView }: { onView: (id: number) => void }) {
  const history = useQuery({ queryKey: ["import-history"], queryFn: calendarEntriesApi.history });
  const batches = history.data?.batches ?? [];
  const isOwner = useCurrentAdmin().role === "owner";
  const [resetBatch, setResetBatch] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Import history</CardTitle>
        <CardDescription>
          Each saved upload that created or updated calendar entries: calendar sheets, and dates with no column saved from an attendance or
          students sheet. Uploads saved before this history was added are not listed; their entries show as &ldquo;{LEGACY}&rdquo;.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Banner msg={msg} />
        {history.error && <p className="text-sm text-red-700">{history.error.message}</p>}
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-muted text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Uploaded</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Date range</th>
                <th className="px-3 py-2 font-medium">Degrees</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Entries</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id} className="border-t border-border align-top">
                  <td className="px-3 py-2">
                    <div className="font-medium break-all">{b.file_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {batchKindLabel[b.kind] ?? b.kind} · upload #{b.id}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Who at={b.uploaded_at} by={b.uploaded_by} unknown="" />
                  </td>
                  <td className="px-3 py-2 tabular-nums">{b.summary.created}</td>
                  <td className="px-3 py-2 tabular-nums">{b.summary.updated}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {b.summary.from ? (b.summary.from === b.summary.to ? fmtDate(b.summary.from) : `${fmtDate(b.summary.from)} – ${fmtDate(b.summary.to!)}`) : "–"}
                  </td>
                  <td className="px-3 py-2">{b.summary.degrees.length ? b.summary.degrees.map((d) => (d === "ALL" ? "All" : d)).join(", ") : "–"}</td>
                  <td className="px-3 py-2">{batchStatus(b)}</td>
                  <td className="px-3 py-2">
                    {b.current_entries > 0 ? (
                      <div className="flex flex-col items-start gap-1">
                        <Button size="sm" variant="outline" onClick={() => onView(b.id)}>
                          View {b.current_entries} entr{b.current_entries === 1 ? "y" : "ies"}
                        </Button>
                        {isOwner && (
                          <button
                            type="button"
                            className="text-xs font-medium text-red-700 hover:underline"
                            onClick={() => {
                              setMsg(null);
                              setResetBatch(b.id);
                            }}
                          >
                            Remove these entries…
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {b.summary.created + b.summary.updated ? "None now: changed or removed later" : "None"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {history.isSuccess && batches.length === 0 && (
            <p className="px-3 py-4 text-sm text-muted-foreground">No uploads have written calendar entries since this history was added.</p>
          )}
          {history.isPending && <p className="px-3 py-4 text-sm text-muted-foreground">Loading…</p>}
        </div>
        <p className="text-xs text-muted-foreground">
          Calendar entries apply per degree (All, BITS, CDU); sections are not part of calendar entries. &ldquo;Entries&rdquo; counts the entries
          that still come from that upload: a later save of the same date and degree moves the entry to the newer source.
        </p>
      </CardContent>
      {isOwner && resetBatch !== null && (
        <ResetImportedDialog
          key={resetBatch}
          open
          initialBatch={resetBatch}
          batches={batches}
          onClose={() => setResetBatch(null)}
          onDone={(text) => setMsg({ ok: true, text })}
        />
      )}
    </Card>
  );
}
