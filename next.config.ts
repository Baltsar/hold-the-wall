import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  turbopack: {
    // A stray package-lock.json in the home directory would otherwise be taken as the root.
    root: path.resolve(import.meta.dirname),
  },
};

export default nextConfig;
