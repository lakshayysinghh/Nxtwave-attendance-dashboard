"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Pencil, UserMinus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeading } from "@/components/admin-shell";
import { RemoveStudentCard, StudentFormCard } from "@/components/student-form";
import { StudentProfile, adminFields } from "@/components/student-lookup";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

/** The admin view of one student: exactly what the student sees, plus admin-only fields. */
export function AdminStudentPage({ niatId }: { niatId: string }) {
  const router = useRouter();
  const profile = useQuery({ queryKey: ["student", niatId], queryFn: () => api.adminStudent(niatId), retry: false });
  const p = profile.data;

  const [panel, setPanel] = useState<"none" | "edit" | "remove">("none");

  // Back keeps the list's filters (they live in its URL); a page opened in a new tab has no history.
  const back = () => (window.history.length > 1 ? router.back() : router.push("/admin/students"));

  return (
    <>
      <PageHeading title={p?.student.name ?? "Student"} description={p ? `${p.student.niat_id} · what this student sees, plus admin details` : niatId}>
        <Button variant="outline" onClick={back}>
          <ArrowLeft className="size-4" /> Back
        </Button>
        {p && (
          <>
            <Button variant="outline" onClick={() => setPanel(panel === "edit" ? "none" : "edit")}>
              <Pencil className="size-4" /> Edit
            </Button>
            <Button variant="outline" className="text-red-700 hover:text-red-800" onClick={() => setPanel(panel === "remove" ? "none" : "remove")}>
              <UserMinus className="size-4" /> Remove
            </Button>
          </>
        )}
        <Link
          href="/admin/attendance"
          className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Mark attendance
        </Link>
      </PageHeading>

      {profile.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {profile.error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{profile.error.message}</p>}
      {p && panel === "edit" && <StudentFormCard key={p.student.niat_id} student={p.student} onDone={() => setPanel("none")} />}
      {p && panel === "remove" && <RemoveStudentCard student={p.student} today={p.today} onDone={() => setPanel("none")} />}
      {p && p.student.status === "dropped" && (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          This student is marked as dropped{p.student.dropped_on ? ` from ${p.student.dropped_on}` : ""}. They don&apos;t appear in the student search or on the marking
          sheet. Use Edit to make them active again.
        </p>
      )}
      {p && (
        <StudentProfile
          key={p.student.niat_id}
          p={p}
          monthKey="admin-month"
          fetchMonth={(ym) => api.adminMonth(p.student.niat_id, ym)}
          extraFields={adminFields(p.student)}
        />
      )}
    </>
  );
}
