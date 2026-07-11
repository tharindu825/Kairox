import type { NextConfig } from "next";
import os from "os";

function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        ips.push(iface.address);
        ips.push(`${iface.address}:3000`);
      }
    }
  }
  return ips;
}

const nextConfig: NextConfig = {
  /* config options here */
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "[IP_ADDRESS]",
    ...getLocalIPs(),
  ],
};

export default nextConfig;
