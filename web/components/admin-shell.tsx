"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  GraduationCap,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  Upload,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useState } from "react";

import { ChangePasswordCard, useAdminSession } from "@/components/auth";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { api, type Me } from "@/lib/api";

const AdminContext = createContext<Me | null>(null);

/** The signed-in admin, available inside AdminShell. */
export function useCurrentAdmin(): Me {
  const me = useContext(AdminContext);
  if (!me) throw new Error("useCurrentAdmin must be used inside AdminShell");
  return me;
}

type NavItem = { href: string; label: string; icon: LucideIcon; ownerOnly?: boolean };

const nav: NavItem[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/students", label: "Students", icon: Users },
  { href: "/admin/attendance", label: "Mark Attendance", icon: ClipboardCheck },
  { href: "/admin/imports", label: "Imports", icon: Upload },
  { href: "/admin/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/admin/terms", label: "Terms", icon: CalendarRange },
  { href: "/admin/admins", label: "Manage Admins", icon: ShieldCheck, ownerOnly: true },
];

/**
 * Layout for every signed-in admin page: top bar, sidebar (a drawer on small
 * screens) and an independently scrolling content area. It also sends
 * signed-out visitors to /admin/login and enforces a pending password change.
 * The API checks all of this again on every request.
 */
export function AdminShell({ children }: { children: React.ReactNode }) {
  const me = useAdminSession();
  const [drawer, setDrawer] = useState(false);
  const [changing, setChanging] = useState(false);

  if (me.isPending || !me.data) {
    return <p className="p-6 text-sm text-muted-foreground">{me.error ? me.error.message : "Loading…"}</p>;
  }
  const admin = me.data;

  return (
    <AdminContext.Provider value={admin}>
      <div className="flex h-dvh flex-col">
        <TopBar me={admin} onMenu={() => setDrawer(true)} onChangePassword={() => setChanging(true)} />
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-60 shrink-0 overflow-y-auto border-r border-border bg-card lg:block">
            <SideNav me={admin} />
          </aside>
          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
              {admin.must_change_password ? <ChangePasswordCard forced /> : children}
            </div>
          </main>
        </div>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Close menu" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="font-semibold text-primary">Menu</span>
              <button type="button" onClick={() => setDrawer(false)} className="rounded-md p-1 hover:bg-muted" aria-label="Close menu">
                <X className="size-5" />
              </button>
            </div>
            <SideNav me={admin} onNavigate={() => setDrawer(false)} />
          </aside>
        </div>
      )}

      {changing && !admin.must_change_password && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 pt-16" role="dialog" aria-modal="true">
          <ChangePasswordCard onDone={() => setChanging(false)} />
        </div>
      )}
    </AdminContext.Provider>
  );
}

function TopBar({ me, onMenu, onChangePassword }: { me: Me; onMenu: () => void; onChangePassword: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 bg-primary px-3 text-white sm:px-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onMenu} className="rounded-md p-1.5 hover:bg-white/10 lg:hidden" aria-label="Open menu">
          <Menu className="size-5" />
        </button>
        <Link href="/admin" className="flex items-center gap-2">
          <Logo onDark />
          <span className="hidden font-semibold tracking-tight sm:inline">NxtWave Attendance</span>
        </Link>
      </div>
      <div className="flex items-center gap-1.5 text-sm sm:gap-2">
        <span className="hidden max-w-56 truncate text-white/85 md:inline" title={me.email}>
          {me.email}
        </span>
        <span className="rounded bg-white/15 px-1.5 py-0.5 text-xs font-medium">{me.role === "owner" ? "Owner" : "Admin"}</span>
        <button type="button" onClick={onChangePassword} className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-white/10" title="Change password">
          <KeyRound className="size-4" />
          <span className="hidden sm:inline">Change password</span>
        </button>
        <Button
          size="sm"
          variant="outline"
          className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white"
          onClick={async () => {
            await api.logout();
            qc.clear();
            router.replace("/admin/login");
          }}
        >
          <LogOut className="size-4" />
          <span className="hidden sm:inline">Sign out</span>
        </Button>
      </div>
    </header>
  );
}

function SideNav({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/"));
  return (
    <nav className="flex flex-col gap-1 p-3" aria-label="Admin">
      {nav
        .filter((item) => !item.ownerOnly || me.role === "owner")
        .map(({ href, label, icon: Icon }) => {
          const on = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={on ? "page" : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
                on ? "bg-primary text-primary-foreground" : "text-slate-700 hover:bg-muted hover:text-primary"
              }`}
            >
              <Icon className="size-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      <div className="my-2 border-t border-border" />
      <Link href="/student" onClick={onNavigate} className="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-600 hover:bg-muted hover:text-primary">
        <GraduationCap className="size-4 shrink-0" />
        Student view
      </Link>
    </nav>
  );
}

export function PageHeading({ title, description, children }: { title: string; description?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-primary">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
