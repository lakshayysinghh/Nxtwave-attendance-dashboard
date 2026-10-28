import type { NextConfig } from "next";

// The browser only ever talks to this app; /api/* is proxied to the Go API so
// the admin session cookie stays first-party and no CORS is needed.
// Rewrites are resolved at build time, so API_ORIGIN must be set before `next build`.
const apiOrigin = (process.env.API_ORIGIN ?? "").replace(/\/+$/, "");
if (!apiOrigin && process.env.VERCEL) {
  throw new Error("API_ORIGIN must be set in the Vercel project (e.g. https://attendance-api.onrender.com)");
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiOrigin || "http://localhost:8080"}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
