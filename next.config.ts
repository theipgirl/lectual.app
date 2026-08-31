import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Must stay true: the mirrored /auth/callback route and every internal link
  // assume trailing-slash URLs, and the main repo (theipgirl/lectual) sets the
  // same. A mismatch costs an extra redirect hop on the single-use magic-link
  // code, which is exactly where a dropped `?code=` becomes "nothing happened".
  trailingSlash: true,
};

export default nextConfig;
