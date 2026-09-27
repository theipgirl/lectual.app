import type { Metadata } from "next";
import { NOT_A_LAW_FIRM_DISCLAIMER } from "@/lib/legal/disclaimer";

/**
 * The shell for the client's proposal — deliberately OUTSIDE `/dashboard`, so
 * nothing in the firm layout's read path (session, rail, queue badge) runs here
 * and nothing hints at a workspace behind the page. The visitor is the firm's
 * client, not a Lectual user: no navigation, no sign-in link.
 *
 * ── ROBOTS AND REFERRER ARE PART OF THE TOKEN'S SECURITY ────────────────────
 * The token in this URL is the whole credential (src/lib/quotes/public.ts).
 *  - `noindex, nofollow`: a crawler that reached a forwarded link must not put
 *    a firm's fee proposal into a search index.
 *  - `no-referrer`: any outbound request this page makes would otherwise carry
 *    the full URL, token included, in a Referer header to someone else.
 *
 * The UPL disclaimer is rendered here, structurally, so every state of the page
 * carries it — this page shows a client a fee agreement, and it is the last
 * place "not a law firm" may go missing. The wording is the app's one constant.
 */
export const metadata: Metadata = {
  title: "Proposal",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

export default function ProposalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100dvh", display: "flex", flexDirection: "column", background: "var(--paper)" }}>
      <main style={{ flex: 1, width: "100%", maxWidth: 760, margin: "0 auto", padding: "40px 20px 24px", boxSizing: "border-box", display: "grid", gap: 18, alignContent: "start" }}>
        {children}
      </main>
      <footer style={{ width: "100%", maxWidth: 760, margin: "0 auto", padding: "0 20px 28px", boxSizing: "border-box" }}>
        <p className="lx-upl" style={{ margin: 0 }}>
          {NOT_A_LAW_FIRM_DISCLAIMER} Lectual provides the software this proposal is presented in; the proposal itself is
          from the firm named above.
        </p>
      </footer>
    </div>
  );
}
