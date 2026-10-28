"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

export function HealthStatus() {
  const { data, error, isPending, isFetching, refetch } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>System status</CardTitle>
        <CardDescription>Result of GET /api/health</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {isPending ? (
          <p className="text-muted-foreground">Checking…</p>
        ) : error ? (
          <p className="text-destructive">API unreachable: {error.message}</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-muted-foreground">api</dt>
            <dd>
              <Badge variant={data.status === "ok" ? "default" : "destructive"}>status: {data.status}</Badge>
            </dd>
            <dt className="text-muted-foreground">database</dt>
            <dd>
              <Badge variant={data.db === "ok" ? "default" : "destructive"}>db: {data.db}</Badge>
            </dd>
            <dt className="text-muted-foreground">time (IST)</dt>
            <dd className="font-mono text-xs leading-5">{data.time_ist}</dd>
          </dl>
        )}
        <Button variant="outline" size="sm" className="self-start" onClick={() => refetch()} disabled={isFetching}>
          {isFetching ? "Checking…" : "Check again"}
        </Button>
      </CardContent>
    </Card>
  );
}
