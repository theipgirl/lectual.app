import type { NextConfig } from "next";
import { clientLinkHosts } from "./src/lib/proposals/client-link-config";

const nextConfig: NextConfig = {
  // Matches lectual: the magic-link callback and every redirect in the ported
  // auth code are written with trailing slashes.
  trailingSlash: true,
  experimental: {
    // The stage reconciliation screen posts an intake sheet (up to 5 MB, see
    // src/lib/intake/sheet-limits.ts) to a server action; the 1 MB default would refuse it before
    // the action could say why. The headroom covers the multipart envelope.
    //
    // allowedOrigins: a client who opens their proposal on the firm's own domain (FIRM_CLIENT_LINK_ORIGINS,
    // reached through the old lectual project's rewrite) posts Accept with that host in Origin, which
    // would not match the forwarded host and be refused as cross-origin. Empty when the env is unset.
    serverActions: { bodySizeLimit: "6mb", allowedOrigins: clientLinkHosts(process.env.FIRM_CLIENT_LINK_ORIGINS) },
  },
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
