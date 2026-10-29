import { PageShell } from "@/components/attendance-ui";
import { LoginForm } from "@/components/auth";

export default function AdminLoginPage() {
  return (
    <PageShell active="admin">
      <LoginForm />
    </PageShell>
  );
}
