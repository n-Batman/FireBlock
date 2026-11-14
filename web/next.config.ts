import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Dev server only: lets a phone load it through a Cloudflare quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
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
};

export default nextConfig;
