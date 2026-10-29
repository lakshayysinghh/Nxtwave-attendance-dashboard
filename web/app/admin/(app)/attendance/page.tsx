import { Suspense } from "react";

import { PageHeading } from "@/components/admin-shell";
import { MarkAttendance } from "@/components/admin-dashboard";

export default function AdminAttendancePage() {
  return (
    <>
      <PageHeading title="Mark Attendance" description="Pick a hall and a date, mark each student Present or Absent for the whole day, then save." />
      <Suspense>
        <MarkAttendance />
      </Suspense>
    </>
  );
}
