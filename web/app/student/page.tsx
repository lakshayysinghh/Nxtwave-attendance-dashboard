import { PageShell } from "@/components/attendance-ui";
import { StudentLookup } from "@/components/student-lookup";

export default function StudentPage() {
  return (
    <PageShell active="student">
      <StudentLookup />
    </PageShell>
  );
}
