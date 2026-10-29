import { AdminShell } from "@/components/admin-shell";

export default function AdminAppLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell>{children}</AdminShell>;
}
