import type { Metadata } from "next";

/**
 * `/r/<token>`: the token in the URL is the whole credential (see
 * src/lib/intake-forms/public.ts). Keep it out of search indexes and out of
 * any Referer this page sends. The proxy also forbids framing it.
 */
export const metadata: Metadata = {
  title: "Questions from your firm",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function RequestLayout({ children }: { children: React.ReactNode }) {
  return children;
}
