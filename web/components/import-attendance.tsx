"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { fmtDate } from "@/components/attendance-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importAttendance, type AttendanceImportResult, type AttendanceImportRow } from "@/lib/api";

const statusStyle: Record<AttendanceImportRow["status"], { label: string; cls: string }> = {
  update: { label: "Will update", cls: "bg-blue-50 text-blue-800 ring-blue-200" },
  unchanged: { label: "No change", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  error: { label: "Error", cls: "bg-red-50 text-red-800 ring-red-200" },
};

/** Upload an attendance sheet (NIAT ID + one column per date), preview, then confirm. */
export function ImportAttendance() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<AttendanceImportResult | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [done, setDone] = useState("");

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSkipErrors(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const check = useMutation({ mutationFn: (f: File) => importAttendance(f), onSuccess: setPreview });
  const save = useMutation({
    mutationFn: () => importAttendance(file!, { commit: true, skipErrors }),
    onSuccess: (res) => {
      setDone(`Imported ${res.file_name}: ${res.saved} attendance record(s) saved for ${res.summary.students_affected} student(s).`);
      reset();
      for (const key of ["students", "sheet", "profile", "month"]) qc.invalidateQueries({ queryKey: [key] });
    },
  });

  const s = preview?.summary;
  const hasErrors = !!preview && (preview.summary.error_rows > 0 || preview.header_errors.length > 0);
  const error = check.error ?? save.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import attendance</CardTitle>
        <CardDescription>
          Upload a .xlsx or .csv file (max 10 MB) with a NIAT ID column and one column per date (19-Aug-2026, 19/08/2026 or
          2026-08-19). Values: Present, Absent, P, A, 1 or 0. Each value marks the whole day (both FH and SH). Blank cells change
          nothing; other columns are ignored.{" "}
          <a href="/sample-attendance.csv" download className="font-medium text-primary underline">
            Download sample CSV
          </a>
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.csv"
            aria-label="Attendance sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setDone("");
              check.reset();
              save.reset();
            }}
            className="text-sm file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium file:text-secondary-foreground"
          />
          <Button variant="outline" className="sm:ml-auto" disabled={!file || check.isPending} onClick={() => file && check.mutate(file)}>
            {check.isPending ? "Checking…" : "Preview"}
          </Button>
        </div>

        {done && <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error.message}</p>}

        {preview && s && (
          <>
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <div>
                <span className="text-muted-foreground">File:</span> <b>{preview.file_name}</b>
              </div>
              <div>
                <span className="text-muted-foreground">Dates ({preview.dates.length}):</span>{" "}
                {preview.dates.length ? preview.dates.map(fmtDate).join(", ") : "none"}
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              <Count label="Rows" n={s.rows} cls="bg-slate-100 text-slate-700 ring-slate-200" />
              <Count label="Students affected" n={s.students_affected} cls="bg-blue-50 text-blue-800 ring-blue-200" />
              <Count label="Records to update" n={s.records_to_update} cls="bg-blue-50 text-blue-800 ring-blue-200" />
              <Count label="Already the same" n={s.unchanged_records} cls="bg-slate-100 text-slate-600 ring-slate-200" />
              <Count label="Blank cells (no change)" n={s.blank_cells} cls="bg-slate-100 text-slate-600 ring-slate-200" />
              <Count label="Skipped cells" n={s.skipped_cells} cls="bg-amber-50 text-amber-800 ring-amber-200" />
              <Count label="Error rows" n={s.error_rows} cls="bg-red-50 text-red-800 ring-red-200" />
            </div>
            <p className="text-xs text-muted-foreground">A record is one half-day mark (FH or SH); each Present/Absent cell sets both.</p>

            {preview.header_errors.length > 0 && (
              <ul className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {preview.header_errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">NIAT ID</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 text-right font-medium">Records</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.row} className={`border-t border-border align-top ${r.status === "error" ? "bg-red-50/40" : ""}`}>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.niat_id || "—"}</td>
                      <td className="px-3 py-2">{r.name || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${statusStyle[r.status].cls}`}>
                          {statusStyle[r.status].label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.changes}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.errors.map((e) => (
                          <div key={e} className="text-red-700">
                            {e}
                          </div>
                        ))}
                        {r.skipped.map((e) => (
                          <div key={e} className="text-amber-800">
                            Skipped: {e}
                          </div>
                        ))}
                        {r.warnings.map((w) => (
                          <div key={w} className="text-amber-800">
                            {w}
                          </div>
                        ))}
                        {r.blank > 0 && <div className="text-muted-foreground">{r.blank} blank cell(s): no change</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {hasErrors ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                  Skip the rows and columns with errors and import the rest
                </label>
              ) : (
                <span className="text-sm text-muted-foreground">No errors found. Nothing is saved until you confirm.</span>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={reset}>
                  Cancel
                </Button>
                <Button disabled={s.records_to_update === 0 || (hasErrors && !skipErrors) || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Importing…" : s.records_to_update === 0 ? "Nothing to import" : "Confirm Import"}
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Count({ label, n, cls }: { label: string; n: number; cls: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium ring-1 ring-inset ${cls}`}>
      {label} <span className="tabular-nums">{n}</span>
    </span>
  );
}
