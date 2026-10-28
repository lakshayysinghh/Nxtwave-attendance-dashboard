// All API calls go to same-origin /api/*; next.config rewrites them to the Go API.

export type Health = {
  status: "ok" | "degraded";
  db: "ok" | "error";
  time_ist: string;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function getJSON<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => null);
  // /api/health answers 503 with a valid body when the DB is down; surface that body.
  if (body !== null && (res.ok || res.status === 503)) return body as T;
  throw new ApiError(res.status, `GET ${path} failed with ${res.status}`);
}

export const api = {
  health: () => getJSON<Health>("/api/health"),
};
