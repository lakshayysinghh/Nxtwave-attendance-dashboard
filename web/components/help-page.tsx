"use client";

import { Search } from "lucide-react";
import { useState } from "react";

import { PageHeading, useCurrentAdmin } from "@/components/admin-shell";
import { canSee, guides, helpOrder, visibleSections, type Guide, type Role } from "@/components/help/guides";
import { GuideBody } from "@/components/help/page-help";
import { Card, CardContent } from "@/components/ui/card";

/** Every guide on one page, for reading or searching all of them at once. */
export function HelpPage() {
  const role: Role = useCurrentAdmin().role === "owner" ? "owner" : "admin";
  const [q, setQ] = useState("");
  const visible = helpOrder.filter((id) => canSee(guides[id], role));
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = words.length ? visible.filter((id) => words.every((w) => guideText(guides[id], role).includes(w))) : visible;

  return (
    <>
      <PageHeading title="Help & guide" description="Every page's guide in one place. On any page, the ⓘ button beside the title opens just that page's guide." />

      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the guide, e.g. internship, holiday, #REF!, password"
          aria-label="Search the guide"
          className="h-10 w-full rounded-md border border-input bg-white pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {!q && (
        <nav aria-label="Topics" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((id) => (
            <a key={id} href={`#${id}`} className="rounded-md border border-border bg-card px-3 py-2 hover:border-primary/40 hover:bg-muted/40">
              <div className="text-sm font-medium text-primary">{guides[id].title}</div>
              <div className="text-xs text-muted-foreground">{guides[id].summary}</div>
            </a>
          ))}
        </nav>
      )}

      {shown.length === 0 && <p className="text-sm text-muted-foreground">Nothing in the guide matches &ldquo;{q}&rdquo;.</p>}

      {shown.map((id) => (
        <Card key={id} id={id} className="scroll-mt-4">
          <CardContent className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-primary">{guides[id].title}</h2>
            <GuideBody guide={guides[id]} role={role} />
          </CardContent>
        </Card>
      ))}
    </>
  );
}

/** All the words of a guide this role can see, for the search box. */
function guideText(g: Guide, role: Role): string {
  const parts: string[] = [g.title, g.summary];
  for (const s of visibleSections(g, role)) {
    parts.push(s.title, s.text ?? "");
    for (const l of s.steps ?? s.points ?? []) if (typeof l === "string" || l.roles.includes(role)) parts.push(typeof l === "string" ? l : l.text);
    if (s.table) {
      parts.push(...s.table.head);
      for (const r of s.table.rows) if (Array.isArray(r) || r.roles.includes(role)) parts.push(...(Array.isArray(r) ? r : r.cells));
    }
  }
  return parts.join(" ").replace(/[*`]/g, "").toLowerCase();
}
