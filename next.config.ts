import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Matches lectual: the magic-link callback and every redirect in the ported
  // auth code are written with trailing slashes.
  trailingSlash: true,
  async headers() {
    return [
      {
        // The client proposal page: its URL token is the whole credential. Never
        // indexed, never sent as a Referer, never framed (a framed Accept button
        // is a clickjacking target). The page's metadata repeats the first two.
        source: "/p/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        ],
      },
    ];
  },
};

export default nextConfig;
