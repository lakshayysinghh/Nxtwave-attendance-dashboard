import { Suspense } from "react";

import { StudentsPage } from "@/components/admin-dashboard";

export default function AdminStudentsPage() {
  return (
    <Suspense>
      <StudentsPage />
    </Suspense>
  );
}
