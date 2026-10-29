import { PageShell } from "@/components/attendance-ui";
import { HealthStatus } from "@/components/health-status";
import { StudentLookup } from "@/components/student-lookup";

export default function Home() {
  return (
    <PageShell active="student">
      <StudentLookup />
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer select-none">System status</summary>
        <div className="mt-3">
          <HealthStatus />
        </div>
      </details>
    </PageShell>
  );
}
