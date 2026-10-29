"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, api, type Me } from "@/lib/api";

export const inputCls =
  "h-10 w-full rounded-md border border-input bg-white px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15";

export const passwordRules = "At least 10 characters, with a letter and a digit. Not part of your email or a common word.";

/** The signed-in admin, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) return null;
        throw e;
      }
    },
    retry: false,
  });
}

/** Sends signed-out visitors to /admin/login. Returns the admin once known. */
export function useAdminSession() {
  const router = useRouter();
  const me = useMe();
  const signedOut = me.isSuccess && me.data === null;
  useEffect(() => {
    if (signedOut) router.replace("/admin/login");
  }, [signedOut, router]);
  return me;
}

export function PasswordInput({
  value,
  onChange,
  autoComplete,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  label: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <span className="relative">
        <input
          className={`${inputCls} pr-16`}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute inset-y-0 right-2 my-auto h-7 rounded px-2 text-xs font-medium text-primary hover:bg-muted"
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? "Hide" : "Show"}
        </button>
      </span>
    </label>
  );
}

const devTag = (
  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-200">
    Development login
  </span>
);

export function LoginForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [devEmail, setDevEmail] = useState("");

  useEffect(() => {
    if (me.data) router.replace("/admin");
  }, [me.data, router]);

  const done = (m: Me) => {
    setPassword("");
    qc.setQueryData(["me"], m);
    router.replace("/admin");
  };
  const login = useMutation({ mutationFn: () => api.login(email.trim(), password), onSuccess: done });
  const devLogin = useMutation({ mutationFn: () => api.devLogin(devEmail.trim()) as Promise<Me>, onSuccess: done });
  const missing = !email.trim() || !password;

  return (
    <div className="flex flex-1 items-start justify-center pt-6 sm:pt-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-lg">Admin sign-in</CardTitle>
          <CardDescription>Use the email and password your Owner gave you.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form
            noValidate
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!missing) login.mutate();
            }}
          >
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Email
              <input className={inputCls} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <PasswordInput label="Password" autoComplete="current-password" value={password} onChange={setPassword} />
            <Button type="submit" className="h-10" disabled={login.isPending}>
              {login.isPending ? "Signing in…" : "Sign in"}
            </Button>
            {login.isIdle && missing && (email || password) && <p className="text-xs text-muted-foreground">Enter both your email and password.</p>}
            {login.error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {login.error instanceof ApiError && login.error.status === 429
                  ? "Too many attempts. Wait a minute and try again."
                  : login.error.message}
              </p>
            )}
          </form>

          <details className="rounded-md border border-dashed border-amber-300 px-3 py-2 text-sm">
            <summary className="cursor-pointer select-none">
              {devTag} <span className="text-muted-foreground">local demo only</span>
            </summary>
            <form
              className="mt-3 flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                devLogin.mutate();
              }}
            >
              <span className="text-xs text-muted-foreground">No password. Works only when the API runs with APP_ENV=development and DEV_LOGIN=true.</span>
              <input className={inputCls} type="email" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} placeholder="admin@demo.local" aria-label="Development login email" />
              <Button type="submit" variant="outline" disabled={!devEmail.trim() || devLogin.isPending}>
                Development sign-in
              </Button>
              {devLogin.error && (
                <p className="text-sm text-red-700">
                  {devLogin.error instanceof ApiError && devLogin.error.status === 404 ? "Development login is turned off." : devLogin.error.message}
                </p>
              )}
            </form>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

/** Change your own password. Shown on first sign-in after the Owner sets or resets it. */
export function ChangePasswordCard({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState("");
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: (m) => {
      setCurrent("");
      setNext("");
      setConfirm("");
      qc.setQueryData(["me"], m);
      qc.invalidateQueries();
      onDone?.();
    },
  });

  return (
    <Card className="w-full max-w-md self-center">
      <CardHeader>
        <CardTitle className="text-lg">{forced ? "Choose your own password" : "Change password"}</CardTitle>
        <CardDescription>
          {forced ? "You signed in with a password set by the Owner. Choose a new one to continue. " : ""}
          {passwordRules} Your other signed-in devices will be signed out.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            setLocalError("");
            if (!current || !next) return setLocalError("Fill in all fields.");
            if (next !== confirm) return setLocalError("The new passwords do not match.");
            change.mutate();
          }}
        >
          <PasswordInput label="Current password" autoComplete="current-password" value={current} onChange={setCurrent} />
          <PasswordInput label="New password" autoComplete="new-password" value={next} onChange={setNext} />
          <PasswordInput label="Repeat new password" autoComplete="new-password" value={confirm} onChange={setConfirm} />
          <div className="flex gap-2">
            <Button type="submit" className="h-10 flex-1" disabled={change.isPending}>
              {change.isPending ? "Saving…" : "Save new password"}
            </Button>
            {!forced && onDone && (
              <Button type="button" variant="outline" className="h-10" onClick={onDone}>
                Cancel
              </Button>
            )}
          </div>
          {(localError || change.error) && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{localError || change.error?.message}</p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

