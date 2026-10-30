import { Suspense } from "react";

import { OverviewPage } from "@/components/admin-dashboard";

export default function AdminOverviewPage() {
  return (
    <Suspense>
      <OverviewPage />
    </Suspense>
  );
}
