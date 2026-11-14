import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Dev server only: lets a phone load it through a Cloudflare quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Cache Components is off: it rejects the `export const runtime` in the risk-grid and parcel-display
  // API routes, and nothing here uses it. Partial prefetching needs it, so it is off too.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
