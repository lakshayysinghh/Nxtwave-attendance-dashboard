import { GraduationCap, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { PageShell } from "@/components/attendance-ui";

const choices = [
  {
    href: "/student",
    icon: GraduationCap,
    title: "Student",
    text: "Check your attendance with your NIAT ID.",
  },
  {
    href: "/admin",
    icon: ShieldCheck,
    title: "Admin portal",
    text: "Sign in to mark attendance, import sheets and manage students.",
  },
];

export default function Home() {
  return (
    <PageShell>
      <div className="flex flex-1 flex-col justify-center gap-6 py-4 sm:py-10">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-primary sm:text-3xl">DSA Attendance</h1>
          <p className="mt-1 text-sm text-muted-foreground">Who are you?</p>
        </div>
        <div className="mx-auto grid w-full max-w-3xl gap-4 sm:grid-cols-2">
          {choices.map(({ href, icon: Icon, title, text }) => (
            <Link
              key={href}
              href={href}
              className="group flex flex-col items-center gap-3 rounded-xl border border-border bg-card px-6 py-10 text-center hover:border-primary focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none"
            >
              <span className="flex size-14 items-center justify-center rounded-full bg-accent text-primary">
                <Icon className="size-7" />
              </span>
              <span className="text-xl font-semibold text-primary">{title}</span>
              <span className="text-sm text-muted-foreground">{text}</span>
            </Link>
          ))}
        </div>
      </div>
    </PageShell>
  );
}
