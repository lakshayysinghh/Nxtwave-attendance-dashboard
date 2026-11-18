"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Copy, FileSpreadsheet, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { PageHeading } from "@/components/admin-shell";
import { fmtDate } from "@/components/attendance-ui";
import { rangeInputCls } from "@/components/date-range";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { exportApi, type AttendanceExport, type ExportDegree } from "@/lib/api";

/*
 * Backup export for the team's master sheet: the saved attendance for a day
 * (or a few days), one block per degree, in the same row order as the student
 * import file. Copy pastes just the date columns, so it drops straight into
 * the sheet's date column starting at row 2.
 */

const addDays = (day: string, n: number) => {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const valueTone = (v: string) => {
  switch (v) {
    case "Present":
    case "Internship Period":
      return "text-emerald-700";
    case "Absent":
    case "Term 5 Registration Pending":
      return "text-red-700";
    default:
      return "text-muted-foreground";
  }
};

/** Tab-separated values only (no IDs or names), one line per student. */
const valuesTSV = (deg: ExportDegree) => deg.rows.map((r) => r.values.join("\t")).join("\n");

export function ExportPage() {
  // Blank means "today" (IST, decided by the API).
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [range, setRange] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = useQuery({ queryKey: ["export", from, range ? to : from], queryFn: () => exportApi.attendance(from, range ? to : from) });
  const data = q.data;
  const today = data?.today ?? "";
  const shownFrom = from || data?.from || "";
  const shownTo = (range ? to : from) || data?.to || shownFrom;

  const pickDay = (day: string) => {
    setRange(false);
    setFrom(day);
    setTo("");
  };

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const { blob, name } = await exportApi.excel(shownFrom, shownTo);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  const span = data ? (data.from === data.to ? fmtDate(data.from) : `${fmtDate(data.from)} – ${fmtDate(data.to)}`) : "";
  const unmarked = data?.degrees.reduce((n, d) => n + d.unmarked, 0) ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <PageHeading title="Export" description="Download or copy the saved attendance, in your master sheet's row order, as a backup.">
        <Button onClick={download} disabled={!data || busy}>
          <FileSpreadsheet className="size-4" /> {busy ? "Preparing…" : "Download Excel"}
        </Button>
      </PageHeading>

      <Card>
        <CardContent className="flex flex-col gap-3 py-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              {range ? "From" : "Date"}
              <input type="date" className={rangeInputCls} value={shownFrom} max={today || undefined} onChange={(e) => setFrom(e.target.value)} aria-label={range ? "From date" : "Date"} />
            </label>
            {range && (
              <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                To
                <input type="date" className={rangeInputCls} value={shownTo} min={shownFrom || undefined} max={today || undefined} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
              </label>
            )}
            <div className="flex flex-wrap gap-1.5 pb-1">
              {today && (
                <>
                  <Chip on={!range && shownFrom === today} onClick={() => pickDay(today)}>
                    Today
                  </Chip>
                  <Chip on={!range && shownFrom === addDays(today, -1)} onClick={() => pickDay(addDays(today, -1))}>
                    Yesterday
                  </Chip>
                </>
              )}
              <Chip
                on={range}
                onClick={() => {
                  if (range) {
                    setRange(false);
                    setTo("");
                  } else {
                    setRange(true);
                    setFrom(shownFrom);
                    setTo(shownTo);
                  }
                }}
              >
                Several days
              </Chip>
            </div>
          </div>
          {data && (
            <p className="text-sm text-muted-foreground">
              {span}: one column per date ({data.headers.join(", ")}). Excel has one tab per degree.
            </p>
          )}
          {unmarked > 0 && (
            <p className="flex items-center gap-1.5 text-sm text-amber-700">
              <TriangleAlert className="size-4" /> {unmarked.toLocaleString("en-IN")} class {unmarked === 1 ? "day is" : "days are"} not marked yet; those cells will be blank.
            </p>
          )}
          {(error || q.error) && <p className="text-sm text-red-700">{error ?? (q.error as Error).message}</p>}
        </CardContent>
      </Card>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {data?.degrees
        .filter((d) => d.rows.length > 0)
        .map((d) => <DegreeBlock key={d.degree} deg={d} data={data} />)}
      {data && data.degrees.every((d) => d.rows.length === 0) && <p className="text-sm text-muted-foreground">No students yet. Import students first.</p>}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${on ? "bg-primary text-primary-foreground ring-primary" : "bg-white text-slate-700 ring-input hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}

function DegreeBlock({ deg, data }: { deg: ExportDegree; data: AttendanceExport }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const first = deg.rows[0];
  const last = deg.rows[deg.rows.length - 1];

  async function copy() {
    try {
      await navigator.clipboard.writeText(valuesTSV(deg));
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>
            {deg.degree} · {deg.rows.length.toLocaleString("en-IN")} students
          </CardTitle>
          <CardDescription>
            Check before pasting: row 2 is <span className="font-mono">{first.niat_id}</span>, the last row ({deg.rows.length + 1}) is{" "}
            <span className="font-mono">{last.niat_id}</span>.
          </CardDescription>
        </div>
        <Button variant="outline" onClick={copy}>
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copied ? "Copied" : `Copy ${data.headers.length > 1 ? "columns" : "column"}`}
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          In your {deg.degree} tab, click row 2 of the <span className="font-medium text-slate-700">{data.headers[0]}</span> column and paste.
        </p>
        {copyError && <p className="text-sm text-red-700">The browser blocked copying. Use Download Excel instead.</p>}
        {deg.unordered > 0 && (
          <p className="flex items-start gap-1.5 text-sm text-amber-700">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            {deg.unordered.toLocaleString("en-IN")} {deg.unordered === 1 ? "student has" : "students have"} no row position from a student import, so{" "}
            {deg.unordered === 1 ? "it is" : "they are"} listed last and may not line up with your sheet. Re-import the {deg.degree} student file to fix the order.
          </p>
        )}
        {deg.unmarked > 0 && (
          <p className="text-sm text-amber-700">
            {deg.unmarked.toLocaleString("en-IN")} class {deg.unmarked === 1 ? "day" : "days"} not marked yet in {deg.degree}.
          </p>
        )}
        <div className="max-h-[28rem] overflow-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Row</th>
                <th className="px-3 py-2 font-medium">NIAT ID</th>
                <th className="px-3 py-2 font-medium">Student Full Name</th>
                <th className="px-3 py-2 font-medium">Section</th>
                {data.headers.map((h) => (
                  <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {deg.rows.map((r, i) => (
                <tr key={r.niat_id} className="border-t">
                  <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{i + 2}</td>
                  <td className="px-3 py-1.5 font-mono text-xs">{r.niat_id}</td>
                  <td className="px-3 py-1.5">
                    {r.name}
                    {r.dropped && <span className="ml-1.5 text-xs text-muted-foreground">(dropped)</span>}
                  </td>
                  <td className="px-3 py-1.5">{r.section}</td>
                  {r.values.map((v, j) => (
                    <td key={data.dates[j]} className={`whitespace-nowrap px-3 py-1.5 ${valueTone(v)}`}>
                      {v || "–"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
