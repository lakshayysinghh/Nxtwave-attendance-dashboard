"use client";

import { ChevronRight, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { Sheet } from "@/components/ui/overlay";

/*
 * The drawer behind a clickable statistic: the students it counts, with
 * search, degree / section / hall filters and a sort. Rows come from the API
 * as they are; this only searches, filters and orders what it was given.
 * Clicking a student opens their record.
 */

export type SheetStudent = { niat_id: string; name: string; degree: string; section: string; hall_no: string };

export type SheetSort<T> = { label: string; compare: (a: T, b: T) => number };

const selectCls = "h-9 w-full min-w-0 rounded-lg border border-input bg-white px-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const hallLabel = (h: string) => h || "No hall";
const NO_HALL = "__none__";

export const byName = <T extends SheetStudent>(a: T, b: T) => a.name.localeCompare(b.name);

export function StudentSheet<T extends SheetStudent>({
  open,
  onOpenChange,
  title,
  description,
  rows,
  loading,
  error,
  metric,
  detail,
  sorts,
  footer,
  emptyText = "No students.",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  rows: T[] | undefined;
  loading?: boolean;
  error?: string;
  /** The figure on the right of each row, e.g. "3 days" or a % badge. */
  metric: (row: T) => React.ReactNode;
  /** A small line under the student, e.g. "P 4 · A 1". */
  detail?: (row: T) => React.ReactNode;
  /** The first sort is the default. */
  sorts: SheetSort<T>[];
  footer?: React.ReactNode;
  emptyText?: string;
}) {
  const [q, setQ] = useState("");
  const [degree, setDegree] = useState("");
  const [section, setSection] = useState("");
  const [hall, setHall] = useState("");
  const [sort, setSort] = useState(0);

  const all = useMemo(() => rows ?? [], [rows]);
  const degrees = [...new Set(all.map((r) => r.degree))].sort();
  const sections = [...new Set(all.filter((r) => !degree || r.degree === degree).map((r) => r.section))].sort();
  const halls = [...new Set(all.filter((r) => !degree || r.degree === degree).map((r) => r.hall_no))].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, undefined, { numeric: true }),
  );
  const needle = q.trim().toLowerCase();
  const shown = all
    .filter(
      (r) =>
        (!needle || r.name.toLowerCase().includes(needle) || r.niat_id.toLowerCase().includes(needle)) &&
        (!degree || r.degree === degree) &&
        (!section || r.section === section) &&
        (!hall || r.hall_no === (hall === NO_HALL ? "" : hall)),
    )
    .sort(sorts[sort]?.compare ?? byName);
  const narrowed = shown.length !== all.length;

  const reset = (o: boolean) => {
    if (!o) {
      setQ("");
      setDegree("");
      setSection("");
      setHall("");
      setSort(0);
    }
    onOpenChange(o);
  };

  const toolbar = (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tracking-tight text-foreground tabular-nums">{rows ? all.length.toLocaleString("en-IN") : "…"}</span>
        <span className="text-sm text-muted-foreground">
          student{all.length === 1 ? "" : "s"}
          {narrowed && ` · ${shown.length} shown`}
        </span>
      </div>
      <label className="relative">
        <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or NIAT ID"
          aria-label="Search these students"
          className="h-9 w-full rounded-lg border border-input bg-white pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        {degrees.length > 1 && (
          <select
            className={selectCls}
            aria-label="Degree"
            value={degree}
            onChange={(e) => {
              setDegree(e.target.value);
              setSection("");
              setHall("");
            }}
          >
            <option value="">All degrees</option>
            {degrees.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        )}
        {sections.length > 1 && (
          <select className={selectCls} aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)}>
            <option value="">All sections</option>
            {sections.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        )}
        {halls.length > 1 && (
          <select className={selectCls} aria-label="Hall" value={hall} onChange={(e) => setHall(e.target.value)}>
            <option value="">All halls</option>
            {halls.map((h) => (
              <option key={h || NO_HALL} value={h || NO_HALL}>
                {hallLabel(h)}
              </option>
            ))}
          </select>
        )}
        {sorts.length > 1 && (
          <select className={selectCls} aria-label="Sort" value={sort} onChange={(e) => setSort(Number(e.target.value))}>
            {sorts.map((s, i) => (
              <option key={s.label} value={i}>
                {s.label}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  );

  return (
    <Sheet open={open} onOpenChange={reset} title={title} description={description} toolbar={toolbar} footer={footer} width="sm:max-w-lg" closeLabel="Close list">
      {error ? (
        <p className="text-sm text-red-600">{error}</p>
      ) : loading && !rows ? (
        <ul className="flex flex-col gap-2" aria-label="Loading">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="h-14 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </ul>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{all.length ? "No student matches." : emptyText}</p>
      ) : (
        <ul className="-mx-2 flex flex-col" aria-label={title}>
          {shown.map((r) => (
            <li key={r.niat_id}>
              <Link
                href={`/admin/students/${encodeURIComponent(r.niat_id)}`}
                className="group flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-muted/70 focus-visible:bg-muted/70 focus-visible:outline-none"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {r.name
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => w[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium text-foreground">{r.name}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {r.niat_id} · {r.degree} · {r.section} · {hallLabel(r.hall_no)}
                  </span>
                  {detail && <span className="text-xs leading-snug text-muted-foreground tabular-nums">{detail(r)}</span>}
                </span>
                <span className="shrink-0 text-right text-sm font-semibold text-foreground tabular-nums">{metric(r)}</span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
