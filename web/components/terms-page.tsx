"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { fmtDate } from "@/components/attendance-ui";
import { inputCls } from "@/components/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { termsApi, type TermRow } from "@/lib/api";

export function TermsPage() {
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Terms</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Attendance is counted only inside a term. Terms cannot overlap, and the current term is used for all percentages.
        </p>
      </div>
      <TermList />
      <TermForm />
    </>
  );
}

// Every page showing percentages reads terms, so refresh everything after a change.
const refreshAll = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries();

function TermList() {
  const list = useQuery({ queryKey: ["terms"], queryFn: termsApi.list });
  return (
    <Card>
      <CardHeader>
        <CardTitle>All terms</CardTitle>
      </CardHeader>
      <CardContent>
        {list.error && <p className="text-sm text-red-700">{list.error.message}</p>}
        {list.data?.terms.length === 0 && <p className="text-sm text-muted-foreground">No terms yet. Create one below.</p>}
        <ul className="divide-y divide-border rounded-md border border-border">
          {list.data?.terms.map((t) => <TermItem key={t.id} term={t} today={list.data.today} />)}
        </ul>
      </CardContent>
    </Card>
  );
}

function TermItem({ term: t, today }: { term: TermRow; today: string }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const onError = (e: Error) => setMsg({ ok: false, text: e.message });
  const setCurrent = useMutation({
    mutationFn: () => termsApi.update(t.id, { is_current: true }),
    onSuccess: () => refreshAll(qc),
    onError,
  });
  const remove = useMutation({ mutationFn: () => termsApi.remove(t.id), onSuccess: () => refreshAll(qc), onError });
  const status = today < t.start ? "Upcoming" : today > t.end ? "Ended" : "In progress";

  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <div className="font-medium">{t.name}</div>
          <div className="text-sm text-muted-foreground">
            {fmtDate(t.start)} to {fmtDate(t.end)} · {status}
          </div>
        </div>
        {t.is_current && <span className="rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">Current term</span>}
        <div className="flex flex-wrap gap-2">
          {!t.is_current && (
            <Button variant="outline" size="sm" disabled={setCurrent.isPending} onClick={() => setCurrent.mutate()}>
              Set as current
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setEditing((e) => !e)}>
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={remove.isPending}
            onClick={() => {
              setMsg(null);
              remove.mutate();
            }}
          >
            Delete
          </Button>
        </div>
      </div>
      {editing && (
        <TermForm
          term={t}
          onDone={() => {
            setEditing(false);
            setMsg({ ok: true, text: "Saved." });
          }}
        />
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </li>
  );
}

/** Create a term, or edit one when `term` is given. */
function TermForm({ term, onDone }: { term?: TermRow; onDone?: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(term?.name ?? "");
  const [start, setStart] = useState(term?.start ?? "");
  const [end, setEnd] = useState(term?.end ?? "");
  const [current, setCurrent] = useState(false);
  const [error, setError] = useState("");
  const save = useMutation({
    mutationFn: () =>
      term
        ? termsApi.update(term.id, { name: name.trim(), start, end })
        : termsApi.create({ name: name.trim(), start, end, is_current: current }),
    onSuccess: () => {
      refreshAll(qc);
      if (!term) {
        setName("");
        setStart("");
        setEnd("");
        setCurrent(false);
      }
      onDone?.();
    },
    onError: (e: Error) => setError(e.message),
  });

  const form = (
    <form
      className="grid gap-3 sm:grid-cols-4 sm:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        setError("");
        if (!name.trim() || !start || !end) return setError("Fill in the name, start date and end date.");
        if (end < start) return setError("The end date must be on or after the start date.");
        save.mutate();
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Name
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Sem 2" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Start date
        <input className={inputCls} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        End date
        <input className={inputCls} type="date" value={end} min={start || undefined} onChange={(e) => setEnd(e.target.value)} />
      </label>
      <Button type="submit" className="h-10" disabled={save.isPending}>
        {save.isPending ? "Saving…" : term ? "Save changes" : "Create term"}
      </Button>
      {!term && (
        <label className="flex items-center gap-2 text-sm sm:col-span-4">
          <input type="checkbox" checked={current} onChange={(e) => setCurrent(e.target.checked)} />
          Make this the current term
        </label>
      )}
      {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 sm:col-span-4">{error}</p>}
    </form>
  );

  if (term) return <div className="rounded-md border border-border bg-muted/40 p-3">{form}</div>;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create term</CardTitle>
        <CardDescription>For example, &ldquo;Sem 2: 4 Jan 2027 to 15 May 2027&rdquo;. Days between terms are never counted.</CardDescription>
      </CardHeader>
      <CardContent>{form}</CardContent>
    </Card>
  );
}
