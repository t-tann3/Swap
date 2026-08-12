import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Smaller production image for Docker (see web/Dockerfile).
  output: "standalone",
};

export default nextConfig;
