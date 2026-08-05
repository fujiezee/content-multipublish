import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "playwright"],
  allowedDevOrigins: ["127.0.0.1", "localhost", "172.20.10.4"],
};

export default nextConfig;
