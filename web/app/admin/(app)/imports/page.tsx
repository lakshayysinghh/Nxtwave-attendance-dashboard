import { Suspense } from "react";

import { ImportsPage } from "@/components/imports-page";

export default function AdminImportsPage() {
  return (
    <Suspense>
      <ImportsPage />
    </Suspense>
  );
}
