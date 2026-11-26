"use client";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

import { isNoRetryError, isSessionEnded } from "@/lib/api";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    // A 401 anywhere means the session ended (expired, signed out elsewhere,
    // password changed): mark the admin signed out so the shell sends them to
    // /admin/login, instead of leaving pages showing errors until "me" refetches.
    // A wrong password is also 401 but has another code, so it is ignored here.
    const onError = (e: unknown) => {
      if (isSessionEnded(e) && qc.getQueryData(["me"])) qc.setQueryData(["me"], null);
    };
    const qc: QueryClient = new QueryClient({
      queryCache: new QueryCache({ onError }),
      mutationCache: new MutationCache({ onError }),
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          // One retry for network/server errors; never for 401, 403 or 429.
          retry: (failures, e) => failures < 1 && !isNoRetryError(e),
        },
      },
    });
    return qc;
  });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
