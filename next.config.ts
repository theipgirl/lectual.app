import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Matches lectual: the magic-link callback and every redirect in the ported
  // auth code are written with trailing slashes.
  trailingSlash: true,
};

export default nextConfig;
