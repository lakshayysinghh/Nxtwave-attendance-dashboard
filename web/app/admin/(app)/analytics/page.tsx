import { Suspense } from "react";

import { AnalyticsPage } from "@/components/analytics-page";

export default function Analytics() {
  return (
    <Suspense>
      <AnalyticsPage />
    </Suspense>
  );
}
