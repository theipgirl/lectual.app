import { beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";

import { buildAcceptedSnapshot, type PublicQuoteLine } from "@/lib/quotes/public";

/**
 * "Draft engagement letter" on the signed quote's page.
 *
 * The link goes to the pre-filled LOE form for the matter the signature opened,
 * and only when there is somewhere for it to go: the quote is signed, it is
 * linked to a matter, and the firm has the Document Center (the form's pages are
 * `notFound()` without it, so a link would be a dead end that also tells the
 * firm what it lacks). QuoteBuilder is stubbed to read the props the page hands
 * it; the page's data reads are stubbed to a quote in the state under test.
 */

const QUOTE_ID = "3f9a1c00-0000-4000-8000-000000000001";
const MATTER_ID = "5e5e5e5e-0000-4000-8000-000000000009";

const h = vi.hoisted(() => ({
  quote: {} as Record<string, unknown>,
  modules: ["document-center"] as string[],
  builderProps: null as null | Record<string, unknown>,
  Builder: (props: Record<string, unknown>) => {
    h.builderProps = props;
    return null;
  },
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "ok", role: "attorney" }) }));
vi.mock("@/lib/site-origin", () => ({ getSiteOrigin: async () => "https://app.example.test" }));
vi.mock("@/lib/quotes/load", () => ({ loadQuote: async () => ({ status: "ok", quote: h.quote, lines: [] }) }));
vi.mock("@/lib/quotes/store", () => ({ listQuoteEvents: async () => [] }));
vi.mock("@/lib/quotes/service-library", () => ({ listServiceItems: async () => [] }));
vi.mock("@/lib/quotes/clients", () => ({
  quoteClientLabels: async () => new Map(),
  quoteDefaultMark: async () => null,
  quoteMatterRef: async (id: string | null) => (id ? { href: `/dashboard/matters/${id}/`, number: "TM-2026-0005" } : null),
}));
vi.mock("@/lib/payments/quote-payments", () => ({ listQuotePayments: async () => ({ status: "ok", payments: [] }) }));
vi.mock("@/lib/payments/lawpay-connection", () => ({ getLawPayConnection: async () => ({ ok: true, connection: null }) }));
vi.mock("@/lib/payments/accounts", () => ({ listLawPayMappings: async () => ({ status: "ok", rows: [] }) }));
vi.mock("@/lib/payments/lawpay-config", () => ({ lawPayDeploymentMode: () => "test" }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/org/modules", () => ({ orgHasModule: async (m: string) => h.modules.includes(m) }));
vi.mock("@/components/quotes/QuoteBuilder", () => ({ QuoteBuilder: h.Builder }));
vi.mock("@/components/quotes/QuoteParts", () => ({ TermsPanel: () => null }));
vi.mock("@/components/quotes/QuotesRestricted", () => ({ QuotesRestricted: () => null }));
vi.mock("@/components/quotes/PaymentsPanel", () => ({ PaymentsPanel: () => null }));
vi.mock("../../src/app/dashboard/quotes/quotes.css", () => ({}));

const { default: Page } = await import("@/app/dashboard/quotes/[id]/page");

function lines(): PublicQuoteLine[] {
  return [
    { id: "a", kind: "legal_fee", charge_at: "signing", selection: "included", tier_group: null, selected: true, label: "Filing", description: null, quantity: 1, unit_amount_cents: 100_000, sort_index: 0 },
  ];
}

function signedQuote(over: Record<string, unknown> = {}): Record<string, unknown> {
  const acceptedAt = "2026-09-27T15:00:00.000Z";
  return {
    id: QUOTE_ID,
    org_id: "org-a",
    matter_id: MATTER_ID,
    lead_id: null,
    contact_id: null,
    title: "Filing",
    status: "accepted",
    currency: "USD",
    intro_body: null,
    terms_body: null,
    expires_at: null,
    sent_at: "2026-09-20T12:00:00.000Z",
    accepted_at: acceptedAt,
    accepted_by_name: "Nadia Petra",
    public_token: "TOKEN",
    accepted_snapshot: buildAcceptedSnapshot({
      view: { title: "Filing", introBody: null, termsBody: null, expiresAt: null, currency: "USD" },
      lines: lines(),
      acceptedAt,
      name: "Nadia Petra",
      email: "nadia@example.com",
    }),
    ...over,
  };
}

/** Finds the QuoteBuilder element in the page's tree and returns the props the page gave it. */
async function builderProps(): Promise<Record<string, unknown>> {
  h.builderProps = null;
  const tree = await Page({ params: Promise.resolve({ id: QUOTE_ID }) });
  const found: ReactElement[] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!isValidElement(node)) return;
    if (node.type === h.Builder) found.push(node);
    walk((node.props as { children?: ReactNode }).children);
  };
  walk(tree);
  expect(found).toHaveLength(1);
  return found[0].props as Record<string, unknown>;
}

beforeEach(() => {
  h.quote = signedQuote();
  h.modules = ["document-center"];
});

describe("signed quote page — Draft engagement letter", () => {
  it("links a signed quote to the pre-filled form for its matter", async () => {
    const props = await builderProps();
    expect(props.letterHref).toBe(`/dashboard/documents/new/${MATTER_ID}/loe/?quote=${QUOTE_ID}`);
  });

  it("offers no link to a firm without the Document Center", async () => {
    h.modules = [];
    expect((await builderProps()).letterHref).toBeNull();
  });

  it("offers no link when the signature opened no matter", async () => {
    h.quote = signedQuote({ matter_id: null });
    expect((await builderProps()).letterHref).toBeNull();
  });

  it("offers no link on a quote that is not signed", async () => {
    h.quote = signedQuote({ status: "sent", accepted_at: null, accepted_snapshot: null });
    expect((await builderProps()).letterHref).toBeNull();
    h.quote = signedQuote({ status: "draft", accepted_at: null, accepted_snapshot: null });
    expect((await builderProps()).letterHref).toBeNull();
  });
});
