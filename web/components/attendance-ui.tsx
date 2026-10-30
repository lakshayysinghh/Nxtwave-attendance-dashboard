// Shared presentational pieces for the student and admin pages.
import Link from "next/link";

import { Logo } from "@/components/logo";

import type { Band, Mark, Term } from "@/lib/api";

export function SiteHeader({ active }: { active?: "student" | "admin" }) {
  const link = (href: string, label: string, on: boolean) => (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm font-medium ${on ? "bg-white text-primary" : "text-white/85 hover:bg-white/10 hover:text-white"}`}
      aria-current={on ? "page" : undefined}
    >
      {label}
    </Link>
  );
  return (
    <header className="bg-primary text-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <Link href="/" className="flex items-center gap-2">
          <Logo onDark />
          <span className="font-semibold tracking-tight">NxtWave Attendance</span>
        </Link>
        <nav className="flex gap-1">
          {link("/student", "Student", active === "student")}
          {link("/admin", "Admin", active === "admin")}
        </nav>
      </div>
    </header>
  );
}

export function PageShell({ active, children }: { active?: "student" | "admin"; children: React.ReactNode }) {
  return (
    <>
      <SiteHeader active={active} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:py-8">{children}</main>
      <footer className="border-t border-border py-4 text-center text-xs text-muted-foreground">
        DSA Attendance · B.Tech demo project
      </footer>
    </>
  );
}

const markStyle = {
  P: { cls: "bg-green-50 text-green-800 ring-green-200", text: "Present", short: "P" },
  A: { cls: "bg-red-50 text-red-800 ring-red-200", text: "Absent", short: "A" },
  none: { cls: "bg-slate-100 text-slate-600 ring-slate-200", text: "Not marked", short: "–" },
};

/** A Present / Absent / Not marked chip. `short` shows only P, A or –. */
export function MarkChip({ mark, short }: { mark: Mark; short?: boolean }) {
  const s = markStyle[mark ?? "none"];
  return (
    <span className={`inline-flex items-center justify-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls} ${short ? "min-w-7" : ""}`}>
      {short ? s.short : s.text}
    </span>
  );
}

/** Mark legend; the student calendar leaves out "Not marked", which it does not show. */
export function Legend({ showNotMarked = true }: { showNotMarked?: boolean }) {
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><MarkChip mark="P" short /> P – Present</span>
      <span className="flex items-center gap-1.5"><MarkChip mark="A" short /> A – Absent</span>
      {showNotMarked && <span className="flex items-center gap-1.5"><MarkChip mark={null} short /> Not marked</span>}
    </p>
  );
}

export const bandInfo: Record<Exclude<Band, "none">, { label: string; cls: string; dot: string }> = {
  below_60: { label: "Below 60%", cls: "bg-red-50 text-red-800 ring-red-200", dot: "bg-red-500" },
  "60_to_75": { label: "60% – 75%", cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  "75_plus": { label: "75% and above", cls: "bg-green-50 text-green-800 ring-green-200", dot: "bg-green-600" },
};

export function PctBadge({ pct, band }: { pct: number | null; band: Band }) {
  if (band === "none" || pct === null) return <span className="text-muted-foreground">–</span>;
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold tabular-nums ring-1 ring-inset ${bandInfo[band].cls}`}>
      {pct.toFixed(1)}%
    </span>
  );
}

const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayFmt = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const monthFmt = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

export const fmtDate = (iso: string) => dateFmt.format(new Date(iso + "T00:00:00Z"));
export const fmtDay = (iso: string) => dayFmt.format(new Date(iso + "T00:00:00Z"));
export const fmtMonth = (ym: string) => monthFmt.format(new Date(ym + "-01T00:00:00Z"));

export function TermRange({ term }: { term: Term }) {
  if (!term) return null;
  return (
    <span>
      {term.name}: {fmtDate(term.start)} to {fmtDate(term.end)}
    </span>
  );
}
