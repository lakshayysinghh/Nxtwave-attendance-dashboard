"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";

import { PageHeading } from "@/components/admin-shell";
import { ImportAttendance } from "@/components/import-attendance";
import { ImportCalendar } from "@/components/import-calendar";
import { ImportStudents } from "@/components/import-students";

type Tab = "students" | "attendance" | "calendar";

/** Both import cards stay mounted, so switching tabs keeps an open preview. */
export function ImportsPage() {
  const params = useSearchParams();
  const initial = params.get("tab");
  const [tab, setTab] = useState<Tab>(initial === "attendance" || initial === "calendar" ? initial : "students");
  const tabs: { id: Tab; label: string }[] = [
    { id: "students", label: "Import students" },
    { id: "attendance", label: "Import attendance" },
    { id: "calendar", label: "Import calendar" },
  ];
  return (
    <>
      <PageHeading title="Imports" description="Upload a .xlsx or .csv sheet, check the preview, then confirm. Nothing is saved before you confirm." />
      <div className="inline-flex self-start overflow-hidden rounded-md ring-1 ring-input" role="tablist" aria-label="Import type">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`border-l border-input px-4 py-2 text-sm font-medium first:border-l-0 ${tab === t.id ? "bg-primary text-primary-foreground" : "bg-white hover:bg-muted"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div hidden={tab !== "students"}>
        <ImportStudents />
      </div>
      <div hidden={tab !== "attendance"}>
        <ImportAttendance />
      </div>
      <div hidden={tab !== "calendar"}>
        <ImportCalendar />
      </div>
    </>
  );
}
