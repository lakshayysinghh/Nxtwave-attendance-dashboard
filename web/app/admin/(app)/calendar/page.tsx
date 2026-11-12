import { Suspense } from "react";

import { CalendarPage } from "@/components/calendar-page";

export default function AdminCalendarPage() {
  return (
    <Suspense>
      <CalendarPage />
    </Suspense>
  );
}
