import { Suspense } from "react";

import { AdminStudentPage } from "@/components/admin-student";

export default async function AdminStudentDetailPage({ params }: PageProps<"/admin/students/[niatId]">) {
  const { niatId } = await params;
  return (
    <Suspense>
      <AdminStudentPage niatId={decodeURIComponent(niatId)} />
    </Suspense>
  );
}
