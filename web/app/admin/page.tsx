import { AdminDashboard } from "@/components/admin-dashboard";
import { PageShell } from "@/components/attendance-ui";

export default function AdminPage() {
  return (
    <PageShell active="admin">
      <AdminDashboard />
    </PageShell>
  );
}
