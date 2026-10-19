import type { Metadata } from "next";

/**
 * The shell for the client's proposal — deliberately OUTSIDE `/dashboard`, so
 * nothing in the firm layout's read path (session, rail, queue badge) runs here
 * and nothing hints at a workspace behind the page. The visitor is the firm's
 * client, not a Lectual user: no navigation, no sign-in link.
 *
 * ── ROBOTS AND REFERRER ARE PART OF THE TOKEN'S SECURITY ────────────────────
 * The token in this URL is the whole credential (src/lib/proposals/public.ts).
 *  - `noindex, nofollow`: a crawler that reached a forwarded link must not put
 *    a client's fee proposal into a search index.
 *  - `no-referrer`: any outbound request this page makes (the payment link
 *    included) would otherwise carry the full URL, token and all, in a Referer.
 * next.config.ts repeats both as response headers (and forbids framing), so
 * they hold for non-HTML responses and for the error states too.
 *
 * The page itself carries the "Lectual is software, not a law firm" line in
 * its footer (ProposalDocument / ProposalNotice), so every state has it.
 */
export const metadata: Metadata = {
  title: "Proposal",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return children;
}
