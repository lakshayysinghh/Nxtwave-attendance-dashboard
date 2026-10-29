"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useCurrentAdmin } from "@/components/admin-shell";
import { markQueryKeys } from "@/components/import-attendance";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, studentsApi, type Profile, type StudentForm } from "@/lib/api";

const inputCls =
  "h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15";

/** The degrees table holds BITS and CDU (docs/PLAN.md); the API rejects anything else. */
const DEGREES = ["BITS", "CDU"];

const blank: StudentForm = {
  niat_id: "",
  name: "",
  degree: "BITS",
  section: "",
  level: "",
  hall_no: "",
  poc: "",
  coach: "",
  status: "active",
  joined_on: "",
  dropped_on: "",
};

export function formFor(s: Profile["student"]): StudentForm {
  return {
    name: s.name,
    degree: s.degree,
    section: s.section,
    level: s.level,
    hall_no: s.hall_no,
    poc: s.poc,
    coach: s.coach,
    status: s.status === "dropped" ? "dropped" : "active",
    joined_on: s.joined_on ?? "",
    dropped_on: s.dropped_on ?? "",
  };
}

/** Per-field messages from a 422 response, or {} for other errors. */
function fieldErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError && err.details && typeof err.details === "object" && !Array.isArray(err.details)
    ? (err.details as Record<string, string>)
    : {};
}

/**
 * Add one student (no `student`) or edit one. The NIAT ID can only be set
 * when adding. Saving refreshes every list and profile that shows students.
 */
export function StudentFormCard({ student, onDone }: { student?: Profile["student"]; onDone: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const editing = !!student;
  const [f, setF] = useState<StudentForm>(student ? formFor(student) : blank);
  const set = (k: keyof StudentForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((cur) => ({ ...cur, [k]: e.target.value }));

  const save = useMutation({
    mutationFn: () => (editing ? studentsApi.update(student.niat_id, f) : studentsApi.create(f)),
    onSuccess: (res) => {
      for (const key of markQueryKeys) qc.invalidateQueries({ queryKey: [key] });
      onDone();
      if (!editing) router.push(`/admin/students/${encodeURIComponent(res.niat_id)}`);
    },
  });
  const errs = fieldErrors(save.error);

  const field = (k: keyof StudentForm, label: string, input: React.ReactNode, hint?: string) => (
    <label className="flex flex-col gap-1 text-xs font-medium">
      {label}
      {input}
      {errs[k] ? <span className="font-normal text-red-700">{errs[k]}</span> : hint && <span className="font-normal text-muted-foreground">{hint}</span>}
    </label>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{editing ? `Edit ${student.name}` : "Add a student"}</CardTitle>
        <CardDescription>
          {editing
            ? `NIAT ID ${student.niat_id} can't be changed, because the attendance marks belong to it.`
            : "For one student. To add many, use Imports → Students."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          {!editing &&
            field("niat_id", "NIAT ID *", <input className={`${inputCls} font-mono uppercase`} value={f.niat_id} onChange={set("niat_id")} placeholder="N24H01A0598" required />)}
          {field("name", "Full name *", <input className={inputCls} value={f.name} onChange={set("name")} maxLength={100} required />)}
          {field(
            "degree",
            "Degree *",
            <select className={inputCls} value={f.degree} onChange={set("degree")}>
              {DEGREES.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>,
          )}
          {field("section", "Section *", <input className={`${inputCls} uppercase`} value={f.section} onChange={set("section")} placeholder="S001" required />)}
          {field("level", "Level", <input className={inputCls} value={f.level} onChange={set("level")} placeholder="Level 2" />)}
          {field("hall_no", "Hall", <input className={inputCls} value={f.hall_no} onChange={set("hall_no")} placeholder="Hall 2" />, "H-2 is saved as Hall 2.")}
          {field("poc", "POC (instructor)", <input className={inputCls} value={f.poc} onChange={set("poc")} />, "A new name adds a new POC.")}
          {field("coach", "Success coach", <input className={inputCls} value={f.coach} onChange={set("coach")} />)}
          {field(
            "joined_on",
            "Joined on",
            <input type="date" className={inputCls} value={f.joined_on} onChange={set("joined_on")} />,
            "Blank: counts from the term start.",
          )}
          {editing && (
            <>
              {field(
                "status",
                "Status",
                <select className={inputCls} value={f.status} onChange={set("status")}>
                  <option value="active">Active</option>
                  <option value="dropped">Dropped</option>
                </select>,
              )}
              {f.status === "dropped" &&
                field(
                  "dropped_on",
                  "Dropped on *",
                  <input type="date" className={inputCls} value={f.dropped_on} onChange={set("dropped_on")} required />,
                  "Days after this stop counting.",
                )}
            </>
          )}
          <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : editing ? "Save changes" : "Add student"}
            </Button>
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            {save.error && Object.keys(errs).length === 0 && <span className="text-sm text-red-700">{save.error.message}</span>}
            {Object.keys(errs).length > 0 && <span className="text-sm text-red-700">Fix the fields marked in red.</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/**
 * Removing a student. Marking them dropped is reversible and keeps their
 * marks (days after the drop date stop counting). Deleting permanently also
 * deletes every mark; only the Owner can, after typing the NIAT ID.
 */
export function RemoveStudentCard({ student, today, onDone }: { student: Profile["student"]; today: string; onDone: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const me = useCurrentAdmin();
  const [droppedOn, setDroppedOn] = useState(today);
  const [confirm, setConfirm] = useState("");
  const refresh = () => {
    for (const key of markQueryKeys) qc.invalidateQueries({ queryKey: [key] });
  };

  const drop = useMutation({
    mutationFn: () => studentsApi.update(student.niat_id, { ...formFor(student), status: "dropped", dropped_on: droppedOn }),
    onSuccess: () => {
      refresh();
      onDone();
    },
  });
  const del = useMutation({
    mutationFn: () => studentsApi.remove(student.niat_id, confirm),
    onSuccess: () => {
      refresh();
      router.push("/admin/students");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Remove {student.name}</CardTitle>
        <CardDescription>Choose how. Marking as dropped is usually right; it can be undone from Edit.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-md border border-border p-3 text-sm">
          <div className="font-medium">Mark as dropped (keeps history)</div>
          <p className="text-muted-foreground">
            The student is hidden from the student search and attendance marking. Their marks stay, and days after the drop date stop counting.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs font-medium">
              Dropped on
              <input type="date" className={`${inputCls} w-44`} value={droppedOn} max={today} onChange={(e) => setDroppedOn(e.target.value)} />
            </label>
            <Button disabled={!droppedOn || drop.isPending} onClick={() => drop.mutate()}>
              {drop.isPending ? "Saving…" : "Mark as dropped"}
            </Button>
          </div>
          {drop.error && <p className="text-red-700">{drop.error.message}</p>}
        </div>

        <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
          <div className="font-medium">Delete permanently</div>
          {me.role === "owner" ? (
            <>
              <p>
                Deletes the student and <b>all of their attendance marks</b>. This cannot be undone (only a database backup brings it back). Use it
                for a student added by mistake. Type <b className="font-mono">{student.niat_id}</b> to confirm.
              </p>
              <div className="flex flex-wrap items-end gap-2">
                <input
                  className={`${inputCls} w-56 font-mono uppercase`}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  aria-label="Type the NIAT ID to confirm"
                  placeholder={student.niat_id}
                />
                <Button
                  className="bg-red-700 text-white hover:bg-red-800"
                  disabled={confirm.trim().toUpperCase() !== student.niat_id || del.isPending}
                  onClick={() => del.mutate()}
                >
                  {del.isPending ? "Deleting…" : "Delete student and marks"}
                </Button>
              </div>
              {del.error && <p className="text-red-700">{del.error.message}</p>}
            </>
          ) : (
            <p>Only the Owner can delete a student permanently. Mark them as dropped instead, or ask the Owner.</p>
          )}
        </div>

        <div>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
