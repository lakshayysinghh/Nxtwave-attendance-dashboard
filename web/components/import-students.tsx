"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { importStudents, type ImportResult, type ImportRow } from "@/lib/api";

const actionStyle: Record<ImportRow["action"], { label: string; cls: string }> = {
  new: { label: "New", cls: "bg-green-50 text-green-800 ring-green-200" },
  update: { label: "Update", cls: "bg-blue-50 text-blue-800 ring-blue-200" },
  unchanged: { label: "Unchanged", cls: "bg-slate-100 text-slate-600 ring-slate-200" },
  error: { label: "Error", cls: "bg-red-50 text-red-800 ring-red-200" },
};

/** Upload a students sheet, preview row-level results, then confirm to save. */
export function ImportStudents() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [done, setDone] = useState("");

  const reset = () => {
    setFile(null);
    setPreview(null);
    setSkipErrors(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const check = useMutation({
    mutationFn: (f: File) => importStudents(f),
    onSuccess: setPreview,
  });
  const save = useMutation({
    mutationFn: () => importStudents(file!, { commit: true, skipErrors }),
    onSuccess: (res) => {
      setDone(`Imported ${res.file_name}: ${res.summary.new} new, ${res.summary.updated} updated${res.summary.errors ? `, ${res.summary.errors} row(s) with errors skipped` : ""}.`);
      reset();
      qc.invalidateQueries({ queryKey: ["students"] });
      qc.invalidateQueries({ queryKey: ["sheet"] });
    },
  });

  const s = preview?.summary;
  const toSave = s ? s.new + s.updated : 0;
  const error = check.error ?? save.error;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Import students</CardTitle>
        <CardDescription>
          Upload a .xlsx or .csv file with columns NIAT ID, Student Full Name, Degree, Section, Level, Hall No., Instructor Assigned and
          optional Joined On. Existing students are matched by NIAT ID; blank optional cells keep the saved values.{" "}
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
                      <td className="px-3 py-2">{r.name || "—"}</td>
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

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              {s.errors > 0 ? (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={skipErrors} onChange={(e) => setSkipErrors(e.target.checked)} />
                  Skip the {s.errors} row(s) with errors and import the rest
                </label>
              ) : (
                <span className="text-sm text-muted-foreground">No errors found.</span>
              )}
              <Button disabled={toSave === 0 || (s.errors > 0 && !skipErrors) || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Importing…" : toSave === 0 ? "Nothing to import" : `Import ${toSave} student${toSave === 1 ? "" : "s"}`}
              </Button>
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
