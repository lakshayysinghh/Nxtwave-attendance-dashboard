"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useCurrentAdmin } from "@/components/admin-shell";
import { PasswordInput, inputCls, passwordRules } from "@/components/auth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { adminsApi, type AdminAccount, type Me } from "@/lib/api";

/** Owner-only page. The API enforces this too; regular admins get a 403. */
export function ManageAdmins() {
  const me = useCurrentAdmin();
  if (me.role !== "owner") {
    return <p className="rounded-md border border-border bg-card px-4 py-3 text-sm">Only the Owner can manage admin accounts.</p>;
  }
  return <OwnerView me={me} />;
}

function OwnerView({ me }: { me: Me }) {
  const list = useQuery({ queryKey: ["admins"], queryFn: adminsApi.list });
  const admins = list.data?.admins ?? [];
  const activeOwners = admins.filter((a) => a.role === "owner" && a.active).length;

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">Manage admins</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create admin accounts and share the initial password privately. New admins must choose their own password at first sign-in.
        </p>
      </div>
      <CreateAdmin />
      <Card>
        <CardHeader>
          <CardTitle>Admin accounts</CardTitle>
          <CardDescription>At least one active Owner must always remain.</CardDescription>
        </CardHeader>
        <CardContent>
          {list.error && <p className="text-sm text-red-700">{list.error.message}</p>}
          <ul className="divide-y divide-border rounded-md border border-border">
            {admins.map((a) => (
              <AdminRow key={a.id} admin={a} isMe={a.id === me.id} lastOwner={a.role === "owner" && a.active && activeOwners <= 1} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function CreateAdmin() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState("");
  const create = useMutation({
    mutationFn: () => adminsApi.create(name.trim(), email.trim(), password),
    onSuccess: (a) => {
      setDone(`Created ${a.email}. Share the initial password with them privately; they will be asked to change it.`);
      setName("");
      setEmail("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["admins"] });
    },
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create admin</CardTitle>
        <CardDescription>{passwordRules}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setDone("");
            create.mutate();
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Name
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Email
            <input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </label>
          <PasswordInput label="Initial password" autoComplete="new-password" value={password} onChange={setPassword} />
          <div className="sm:col-span-3">
            <Button type="submit" disabled={!name.trim() || !email.trim() || !password || create.isPending}>
              {create.isPending ? "Creating…" : "Create admin"}
            </Button>
          </div>
        </form>
        {done && <p className="mt-3 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p>}
        {create.error && <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{create.error.message}</p>}
      </CardContent>
    </Card>
  );
}

function AdminRow({ admin: a, isMe, lastOwner }: { admin: AdminAccount; isMe: boolean; lastOwner: boolean }) {
  const qc = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const after = (text: string) => () => {
    setMsg({ ok: true, text });
    setResetting(false);
    setPassword("");
    qc.invalidateQueries({ queryKey: ["admins"] });
  };
  const onError = (e: Error) => setMsg({ ok: false, text: e.message });
  const update = useMutation({
    mutationFn: (change: { active?: boolean; role?: "owner" | "admin" }) => adminsApi.update(a.id, change),
    onSuccess: after("Saved."),
    onError,
  });
  const reset = useMutation({
    mutationFn: () => adminsApi.resetPassword(a.id, password),
    onSuccess: after(isMe ? "Password replaced." : "Password replaced. Their sessions ended; they must choose a new password at next sign-in."),
    onError,
  });

  return (
    <li className="flex flex-col gap-2 px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-48 flex-1">
          <div className="text-sm font-medium">
            {a.name || "—"} {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
          </div>
          <div className="text-xs text-muted-foreground">{a.email}</div>
        </div>
        <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium text-secondary-foreground">{a.role === "owner" ? "Owner" : "Admin"}</span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${a.active ? "bg-green-50 text-green-800 ring-green-200" : "bg-slate-100 text-slate-600 ring-slate-200"}`}
        >
          {a.active ? "Active" : "Deactivated"}
        </span>
        {!a.has_password && <span className="text-xs text-amber-800">No password set</span>}
        {a.must_change_password && <span className="text-xs text-muted-foreground">Must change password</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setResetting((r) => !r)}>
          {resetting ? "Cancel reset" : "Reset password"}
        </Button>
        <Button variant="outline" size="sm" disabled={update.isPending || (a.active && lastOwner)} onClick={() => update.mutate({ active: !a.active })}>
          {a.active ? "Deactivate" : "Activate"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={update.isPending || (a.role === "owner" && lastOwner)}
          onClick={() => update.mutate({ role: a.role === "owner" ? "admin" : "owner" })}
        >
          {a.role === "owner" ? "Make regular admin" : "Make Owner"}
        </Button>
        {lastOwner && <span className="self-center text-xs text-muted-foreground">Only active Owner: cannot be deactivated or demoted.</span>}
      </div>
      {resetting && (
        <form
          className="flex flex-col gap-2 sm:flex-row sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
        >
          <div className="flex-1">
            <PasswordInput label={`New password for ${a.email}`} autoComplete="new-password" value={password} onChange={setPassword} />
          </div>
          <Button type="submit" className="h-10" disabled={!password || reset.isPending}>
            Set password
          </Button>
        </form>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
    </li>
  );
}
