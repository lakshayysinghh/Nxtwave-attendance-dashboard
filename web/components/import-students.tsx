"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRef, useState } from "react";

import { AttendancePreview, Count, attendanceHasErrors, markQueryKeys } from "@/components/import-attendance";
import { studentHref } from "@/components/admin-dashboard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importStudents, type ImportResult, type ImportRow } from "@/lib/api";

const actionStyle: Record<ImportRow["action"], { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-green-50 text-green-800 ring-green-200" },
  update: { label: "Update", cls: "bg-blue-50 text-blue-800 ring-blue-200" },
  unchanged: { label: "Unchanged", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  error: { label: "Error", cls: "bg-red-50 text-red-800 ring-red-200" },
};

/**
 * Upload a students sheet, preview row-level results, then confirm to save.
 * When the sheet also has date columns (like the real attendance sheet), the
 * same preview shows its marks and the same confirm saves them.
 */
export function ImportStudents() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [columnDates, setColumnDates] = useState<Record<number, string>>({});
  const [skipErrors, setSkipErrors] = useState(false);
  const [done, setDone] = useState("");

  const reset = () => {
    setFile(null);
    setPreview(null);
    setColumnDates({});
    setSkipErrors(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const check = useMutation({
    mutationFn: (v: { file: File; columnDates: Record<number, string> }) => importStudents(v.file, { columnDates: v.columnDates }),
    onSuccess: setPreview,
  });
  const recheck = (cd: Record<number, string>) => {
    setColumnDates(cd);
    if (file) check.mutate({ file, columnDates: cd });
  };
  const save = useMutation({
    mutationFn: () => importStudents(file!, { commit: true, skipErrors, columnDates }),
    onSuccess: (res) => {
      const marks = res.attendance ? ` Saved ${res.attendance.saved} half-day mark(s) for ${res.attendance.summary.students_affected} student(s).` : "";
      setDone(
        `Imported ${res.file_name}: ${res.summary.new} new, ${res.summary.updated} updated${res.summary.errors ? `, ${res.summary.errors} row(s) with errors skipped` : ""}.${marks}`,
      );
      reset();
      for (const key of markQueryKeys) qc.invalidateQueries({ queryKey: [key] });
    },
  });

  const s = preview?.summary;
  const att = preview?.attendance;
  const studentsToSave = s ? s.new + s.updated : 0;
  const marksToSave = att?.summary.records_to_update ?? 0;
  const hasErrors = !!s && (s.errors > 0 || (!!att && attendanceHasErrors(att)));
  const error = check.error ?? save.error;
  const saveLabel = [
    studentsToSave > 0 && `${studentsToSave} student${studentsToSave === 1 ? "" : "s"}`,
    marksToSave > 0 && `${marksToSave} mark${marksToSave === 1 ? "" : "s"}`,
  ]
    .filter(Boolean)
    .join(" and ");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import students</CardTitle>
        <CardDescription>
          Upload a .xlsx or .csv file with columns NIAT ID, Student Full Name, Degree, Section, Level, Hall No., Instructor Assigned and
          optional Joined On. Existing students are matched by NIAT ID; blank optional cells keep the saved values. If the sheet also
          has one column per date, its attendance is previewed and saved in the same step, so the full attendance sheet needs only
          one upload.{" "}
          <a href="/sample-students.csv" download className="font-medium text-primary underline">
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
            aria-label="Student sheet"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setColumnDates({});
              setDone("");
              check.reset();
              save.reset();
            }}
            className="text-sm file:mr-3 file:h-9 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:text-sm file:font-medium file:text-secondary-foreground"
          />
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" disabled={!file || check.isPending} onClick={() => file && check.mutate({ file, columnDates })}>
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
              <table className="w-full min-w-[640px] text-sm">
                <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Row</th>
                    <th className="px-3 py-2 font-medium">NIAT ID</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Degree / Section</th>
                    <th className="px-3 py-2 font-medium">Result</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r) => (
                    <tr key={r.row} className={`border-t border-border align-top ${r.action === "error" ? "bg-red-50/40" : ""}`}>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                      <td className="px-3 py-2 font-mono text-xs">{r.niat_id || "—"}</td>
                      <td className="px-3 py-2">
                  {(r.action === "update" || r.action === "unchanged") ? (
                    <Link href={studentHref(r.niat_id)} target="_blank" className="hover:text-primary hover:underline">
                      {r.name || r.niat_id}
                    </Link>
                  ) : (
                    r.name || "—"
                  )}
                </td>
                      <td className="px-3 py-2">
                        {r.degree || "—"} / {r.section || "—"}
                      </td>
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

            {att && (
              <div className="flex flex-col gap-3 border-t border-border pt-3">
                <h3 className="text-sm font-semibold">Attendance in this sheet</h3>
                <AttendancePreview preview={att} columnDates={columnDates} onColumnDates={recheck} />
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {hasErrors ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                  Skip the rows and columns with errors and import the rest
                </label>
              ) : (
                <span className="text-sm text-muted-foreground">No errors found. Nothing is saved until you confirm.</span>
              )}
              <Button disabled={!saveLabel || (hasErrors && !skipErrors) || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Importing…" : !saveLabel ? "Nothing to import" : `Import ${saveLabel}`}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
