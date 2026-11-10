import { vi } from "vitest";
import { createElement } from "react";
import { resetState } from "../fixtures";
import type { Screen } from "../registry";
import { faithe } from "../../../tests/proposals/general-fixture";
import { quoteProposal } from "@/lib/proposals/pricing";
import { sevetriCustom } from "../../../tests/proposals/sevetri-custom-fixture";

// The client's page for a general (flat-fee) proposal, Spec 9's Faithe Williams fixture: the offer and the receipt.
vi.mock("@/lib/site-origin", () => ({ getSiteOrigin: async () => "https://app.example" }));

const clientRender = (mode: "live" | "accepted") => async function generalClientScreen() {
  const { ProposalDocument } = await import("@/components/client-proposal/ProposalDocument");
  const content = faithe();
  const quote = quoteProposal(content, {});
  return createElement(ProposalDocument, {
    mode, content, title: "Proposal", clientName: "Faithe Williams", expiresOn: "2026-11-30",
    firm: { name: "Example Law", slug: "example-law", displayName: "Example Law", contactLine: "hello@law.example · (555) 010-0100" },
    ...(mode === "accepted"
      ? { initialSelection: {}, acceptedQuote: quote, payUrl: "https://pay.example/x" }
      : { onAccept: async () => ({ ok: true as const, payUrl: "https://pay.example/x" }) }),
  });
};

const S = (id: string, title: string, viewport: "desktop" | "phone", mode: "live" | "accepted"): Screen => ({
  id, title, designBoard: "none", viewport, shell: "none", pathname: "/p/x/", prepare: resetState, render: clientRender(mode),
});

// The staff proposal page's "What the client sees" card, drawn with the page's own markup and classes in an aside-width
// column (the full staff page screen in sevetri.screen.tsx is now overridden by the mono-pages store mock in setup.ts).
async function staffPreview() {
  const { ProposalDocument } = await import("@/components/client-proposal/ProposalDocument");
  return (
    <div style={{ padding: 24, background: "var(--paper)", minHeight: "100vh" }}>
      <aside style={{ width: 480 }}>
        <section className="lx-card pe-preview" aria-label="Preview of the client page">
          <div className="pe-preview-head">
            <span className="lx-label">What the client sees</span>
            <span className="lx-note">Updates when you save a section</span>
          </div>
          <div className="pe-preview-body" style={{ maxHeight: "none" }}>
            <ProposalDocument content={sevetriCustom()} title="Trademark Proposal" clientName="Sevetri Wilson" expiresOn="2026-11-30"
              firm={{ name: "RPB Law", slug: "rpb" }} mode="preview" />
          </div>
        </section>
      </aside>
    </div>
  );
}

export const screens: Screen[] = [
  { id: "staff-preview-d", title: "Staff page preview card", designBoard: "none", viewport: "desktop", shell: "none", pathname: "/dashboard/proposals/x/", prepare: resetState, render: staffPreview },
  S("gen-client-offer-d", "General client offer (desktop)", "desktop", "live"),
  S("gen-client-offer-p", "General client offer (phone)", "phone", "live"),
  S("gen-client-receipt-d", "General client receipt (desktop)", "desktop", "accepted"),
  S("gen-client-receipt-p", "General client receipt (phone)", "phone", "accepted"),
];
