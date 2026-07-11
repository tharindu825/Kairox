import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow connections from LAN IPs during local development
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
  ],
};

export default nextConfig;

