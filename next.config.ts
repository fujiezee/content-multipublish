import type { NextConfig } from "next";

const cf = process.env.CF_BUILD === "1";

const nextConfig: NextConfig = {
  serverExternalPackages: cf ? [] : ["better-sqlite3", "playwright"],
  allowedDevOrigins: ["127.0.0.1", "localhost", "172.20.10.4"],
  async redirects() {
    return [
      {
        source: "/favicon.ico",
        destination: "/file.svg",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: cf,
  },
  ...(cf
    ? {
        outputFileTracingExcludes: {
          "*": [
            "node_modules/playwright/**",
            "node_modules/playwright-core/**",
            "node_modules/chromium-bidi/**",
            "node_modules/fsevents/**",
            "node_modules/better-sqlite3/**",
            "data/uploads/**",
            "data/debug/**",
            "data/sessions/**",
            "data/*.db",
            "data/*.db-*",
          ],
        },
        turbopack: {
          resolveAlias: {
            playwright: "./src/lib/shims/playwright.ts",
            "playwright-core": "./src/lib/shims/playwright.ts",
            fsevents: "./src/lib/shims/empty.ts",
            "better-sqlite3": "./src/lib/shims/better-sqlite3.ts",
          },
        },
      }
    : {}),
};

export default nextConfig;
