"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fmtDate, fmtDay } from "@/components/attendance-ui";
import { markQueryKeys } from "@/components/import-attendance";
import { PeriodList } from "@/components/student-lookup";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { internshipsApi, type InternshipResult, type Period, type Profile } from "@/lib/api";

const inputCls =
  "h-9 rounded-md border border-input bg-white px-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

type Form = { periodId: number | null; start: string; end: string };

/**
 * Admin card on the student page: assign, edit, extend, end or cancel an
 * internship, and see every internship and registration-pending period,
 * cancelled ones included. The server checks overlaps and conflicts; this
 * card always runs a check (dry run) before saving.
 */
export function InternshipAdminCard({ p }: { p: Profile }) {
  const qc = useQueryClient();
  const s = p.student;
  const [form, setForm] = useState<Form | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const refresh = () => {
    for (const key of markQueryKeys) qc.invalidateQueries({ queryKey: [key] });
  };
  const cancel = useMutation({
    mutationFn: (id: number) => internshipsApi.cancel(id),
    onSuccess: (r) => {
      setConfirmCancel(null);
      setMsg(`Internship cancelled. ${r.marks_removed} internship mark${r.marks_removed === 1 ? "" : "s"} removed; marks changed by hand were kept.`);
      refresh();
    },
  });

  const editable = (x: Period) => x.kind === "INTERNSHIP" && x.state !== "cancelled";
  const open = (f: Form) => {
    setMsg("");
    setConfirmCancel(null);
    setForm(f);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Internship and registration</CardTitle>
          {s.status === "active" && !form && (
            <Button size="sm" onClick={() => open({ periodId: null, start: p.today, end: p.today })}>
              Assign internship
            </Button>
          )}
        </div>
        <CardDescription>
          Internship days are marked Present. Term 5 registration-pending periods come from imported sheets and are marked Absent. Cancelled
          periods stay here as history.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {msg && <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{msg}</p>}
        {form && (
          <InternshipForm
            key={`${form.periodId}-${form.start}-${form.end}`}
            niatId={s.niat_id}
            initial={form}
            onClose={() => setForm(null)}
            onSaved={(text) => {
              setForm(null);
              setMsg(text);
              refresh();
            }}
          />
        )}
        {p.periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">No internship or registration-pending periods.</p>
        ) : (
          <PeriodList
            periods={p.periods}
            actions={(x) =>
              editable(x) && (
                <div className="flex flex-wrap gap-1.5">
                  {confirmCancel === x.id ? (
                    <>
                      <span className="self-center text-xs text-red-800">Remove its Present marks and cancel?</span>
                      <Button size="sm" className="bg-red-700 text-white hover:bg-red-800" disabled={cancel.isPending} onClick={() => cancel.mutate(x.id)}>
                        {cancel.isPending ? "Cancelling…" : "Yes, cancel"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmCancel(null)}>
                        Keep
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => open({ periodId: x.id, start: x.start, end: x.end })}>
                        Edit / extend
                      </Button>
                      {x.state === "active" && (
                        <Button size="sm" variant="outline" onClick={() => open({ periodId: x.id, start: x.start, end: p.today })}>
                          End today
                        </Button>
                      )}
                      <Button size="sm" variant="outline" className="text-red-700" onClick={() => setConfirmCancel(x.id)}>
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              )
            }
          />
        )}
        {cancel.error && <p className="text-sm text-red-700">{cancel.error.message}</p>}
      </CardContent>
    </Card>
  );
}

/** Dates, then Check (dry run: days and conflicting marks), then Save. */
function InternshipForm({
  niatId,
  initial,
  onClose,
  onSaved,
}: {
  niatId: string;
  initial: Form;
  onClose: () => void;
  onSaved: (msg: string) => void;
}) {
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [overwrite, setOverwrite] = useState(false);
  const [checked, setChecked] = useState<InternshipResult | null>(null);
  const editing = initial.periodId !== null;

  const run = (dryRun: boolean) => {
    const input = { start, end, overwrite, dry_run: dryRun };
    return editing ? internshipsApi.update(initial.periodId!, input) : internshipsApi.create(niatId, input);
  };
  const check = useMutation({ mutationFn: () => run(true), onSuccess: setChecked });
  const save = useMutation({
    mutationFn: () => run(false),
    onSuccess: (r) =>
      onSaved(
        `Internship saved: ${fmtDate(start)} to ${fmtDate(end)}. ${r.marks_saved} day${r.marks_saved === 1 ? "" : "s"} marked Present` +
          (r.marks_kept ? `, ${r.marks_kept} existing mark${r.marks_kept === 1 ? "" : "s"} kept` : "") +
          (r.marks_removed ? `, ${r.marks_removed} internship mark${r.marks_removed === 1 ? "" : "s"} removed` : "") +
          ".",
      ),
  });
  const changed = () => {
    setChecked(null);
    check.reset();
    save.reset();
  };
  const error = check.error ?? save.error;
  const conflicts = checked?.conflicts ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-md border border-violet-200 bg-violet-50/40 p-3 text-sm">
      <div className="font-medium">{editing ? "Edit, extend or end internship" : "Assign internship"}</div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-medium">
          First day
          <input
            type="date"
            className={inputCls}
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              changed();
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium">
          Last day
          <input
            type="date"
            className={inputCls}
            value={end}
            min={start}
            onChange={(e) => {
              setEnd(e.target.value);
              changed();
            }}
          />
        </label>
        <Button variant="outline" disabled={!start || !end || check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? "Checking…" : "Check days"}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>

      {checked && (
        <div className="flex flex-col gap-2">
          <p>
            {checked.days === 0
              ? "No new days: only days no longer covered lose their internship marks."
              : `${checked.days} day${checked.days === 1 ? "" : "s"} will be marked Present (Internship). Holidays and Sundays are marked too but never count.`}
          </p>
          {conflicts.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2">
              <p className="font-medium text-amber-900">
                {conflicts.length} of these day{conflicts.length === 1 ? " already has" : "s already have"} a mark:
              </p>
              <ul className="mt-1 grid gap-0.5 text-xs sm:grid-cols-2">
                {conflicts.map((c) => (
                  <li key={c.date}>
                    {fmtDay(c.date)}: {c.status === "P" ? "Present" : "Absent"}
                    {c.category === "REGISTRATION_PENDING" ? " (registration pending)" : c.category === "INTERNSHIP" ? " (internship)" : ""}
                  </li>
                ))}
              </ul>
              <label className="mt-2 flex items-center gap-2">
                <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                Overwrite these with Present (Internship). Leave unticked to keep them as they are.
              </label>
            </div>
          )}
          <div>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "Saving…" : editing ? "Save changes" : "Assign internship"}
            </Button>
          </div>
        </div>
      )}
      {error && <p className="text-red-700">{error.message}</p>}
    </div>
  );
}
