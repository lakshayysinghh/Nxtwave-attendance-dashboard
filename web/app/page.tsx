import { HealthStatus } from "@/components/health-status";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 bg-background px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Attendance Dashboard</h1>
      <HealthStatus />
    </main>
  );
}
