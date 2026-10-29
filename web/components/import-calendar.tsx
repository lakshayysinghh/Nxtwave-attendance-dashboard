"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { fmtDate } from "@/components/attendance-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importCalendar, type CalendarImportResult, type CalendarImportRow } from "@/lib/api";

const actionStyle: Record<CalendarImportRow["action"], { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-green-50 text-green-800 ring-green-200" },
  update: { label: "Update", cls: "bg-blue-50 text-blue-800 ring-blue-200" },
  unchanged: { label: "Unchanged", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  error: { label: "Error", cls: "bg-red-50 text-red-800 ring-red-200" },
};
const typeLabel: Record<string, string> = { working: "Working", holiday: "Holiday", exam: "Exam", event: "Event" };

export function ImportCalendar() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CalendarImportResult | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [done, setDone] = useState("");

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSkipErrors(false);
    if (inputRef.current) inputRef.current.value = "";
  };
  const check = useMutation({ mutationFn: (f: File) => importCalendar(f), onSuccess: setPreview });
  const save = useMutation({
    mutationFn: () => importCalendar(file!, { commit: true, skipErrors }),
    onSuccess: (res) => {
      setDone(
        `Imported ${res.file_name}: ${res.summary.new} new, ${res.summary.updated} updated${res.summary.errors ? `, ${res.summary.errors} row(s) with errors skipped` : ""}.`,
      );
      reset();
      // Calendar entries change which days count, so refresh every view.
      qc.invalidateQueries();
    },
  });

  const s = preview?.summary;
  const toSave = s ? s.new + s.updated : 0;
  const error = check.error ?? save.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import calendar</CardTitle>
        <CardDescription>
          Upload a .xlsx or .csv file (max 10 MB) with columns Date, Day Type (Working, Holiday, Exam or Event), Applies To (All, BITS or
          CDU), Label and optional Counts (Yes/No, for events). Entries are matched by date and Applies To, so uploading the same file
          again changes nothing. Attendance marks are never deleted.{" "}
          <a href="/sample-calendar.csv" download className="font-medium text-primary underline">
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
            aria-label="Calendar sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setDone("");
              check.reset();
              save.reset();
            }}
            className="text-sm file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium file:text-secondary-foreground"
          />
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" disabled={!file || check.isPending} onClick={() => file && check.mutate(file)}>
              {check.isPending ? "Checking…" : "Check file"}
            </Button>
            {(file || preview) && (
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
            )}
          </div>
        </div>

        {done && <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}
        {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error.message}</p>}

        {preview && s && (
          <>
            <div className="flex flex-wrap gap-2 text-xs">
              <Count label="Rows" n={s.total} cls="bg-slate-100 text-slate-700 ring-slate-200" />
              <Count label="New" n={s.new} cls={actionStyle.new.cls} />
              <Count label="Update" n={s.updated} cls={actionStyle.update.cls} />
              <Count label="Unchanged" n={s.unchanged} cls={actionStyle.unchanged.cls} />
              <Count label="Errors" n={s.errors} cls={actionStyle.error.cls} />
              {s.warnings > 0 && <Count label="Warnings" n={s.warnings} cls="bg-amber-50 text-amber-800 ring-amber-200" />}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full min-w-[680px] text-sm">
                <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Applies to</th>
                    <th className="px-3 py-2 font-medium">Label</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.row} className={`border-t border-border align-top ${r.action === "error" ? "bg-red-50/40" : ""}`}>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{/^\d{4}-\d{2}-\d{2}$/.test(r.date) ? fmtDate(r.date) : r.date || "—"}</td>
                      <td className="px-3 py-2">
                        {typeLabel[r.day_type] ?? (r.day_type || "—")}
                        {r.day_type === "event" && <span className="text-xs text-muted-foreground"> ({r.counts ? "counts" : "not counted"})</span>}
                      </td>
                      <td className="px-3 py-2">{r.applies_to === "ALL" ? "All" : r.applies_to || "—"}</td>
                      <td className="px-3 py-2">{r.label || "—"}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${actionStyle[r.action].cls}`}>
                          {actionStyle[r.action].label}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {r.errors.map((e) => (
                          <div key={e} className="text-red-700">
                            {e}
                          </div>
                        ))}
                        {r.warnings.map((w) => (
                          <div key={w} className="text-amber-800">
                            {w}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {s.errors > 0 ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                  Skip the {s.errors} row(s) with errors and import the rest
                </label>
              ) : (
                <span className="text-sm text-muted-foreground">No errors found. Nothing is saved until you confirm.</span>
              )}
              <div className="flex gap-2">
                <Button variant="outline" onClick={reset}>
                  Cancel
                </Button>
                <Button disabled={toSave === 0 || (s.errors > 0 && !skipErrors) || save.isPending} onClick={() => save.mutate()}>
                  {save.isPending ? "Importing…" : toSave === 0 ? "Nothing to import" : `Import ${toSave} entr${toSave === 1 ? "y" : "ies"}`}
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
