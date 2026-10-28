import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { buildAcceptedSnapshot, type PublicQuoteLine } from "@/lib/quotes/public";
import type { SignedQuoteForLoe, SignedQuotesLoad } from "@/lib/documents/loe-prefill-load";

/**
 * The engagement-letter page, rendered. What a person sees is the contract:
 * the "From signed quote QT-XXXX on <date>" note and link, fields that are
 * ordinary editable inputs, a template choice that is never pre-selected, a
 * picker (and no form) when several quotes are signed, and the blank form of
 * today when there is none — with a failed read said out loud rather than
 * shown as "no signed quote".
 */

const MATTER_ID = "m-1";
const Q1 = "3f9a1c00-0000-4000-8000-000000000001";
const Q2 = "7be0d200-0000-4000-8000-000000000002";

const h = vi.hoisted(() => ({
  load: { status: "ok", quotes: [] } as unknown,
  role: "attorney",
  moduleCalls: 0,
  loadCalls: 0,
  modules: ["document-center"] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
vi.mock("@/lib/matters", () => ({
  getMatter: async () => ({
    id: "m-1",
    org_id: "org-a",
    type: "TM",
    matter_number: "TM-2026-0005",
    title: "Halcyon Rowe LLC",
    mark_text: "HALCYON ROWE",
    package_name: "Enhanced",
    international_classes: [25, 35],
    goods_services: "Clothing",
    lead_id: null,
    owner_name: null,
  }),
  resolveMatterClientName: async () => ({ name: "Nadia Petra", source: "lead" }),
}));
vi.mock("@/lib/matters/docket-summary", () => ({ matterLabel: () => "HALCYON ROWE" }));
vi.mock("@/lib/firm/session", () => ({ resolveFirmSession: async () => ({ kind: "ok", role: h.role }) }));
vi.mock("@/lib/org/profile", () => ({ getFirmTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/documents/loe-prefill-load", () => ({
  loadSignedQuotesForMatter: async () => {
    h.loadCalls += 1;
    return h.load;
  },
}));
vi.mock("@/lib/org/modules", () => ({
  orgHasModule: async (mod: string) => {
    h.moduleCalls += 1;
    return h.modules.includes(mod);
  },
}));
vi.mock("@/app/dashboard/documents/new/[matterId]/loe/actions", () => ({ generateLoeAction: async () => ({}) }));

const { default: Page } = await import("@/app/dashboard/documents/new/[matterId]/loe/page");

function lines(): PublicQuoteLine[] {
  const base = { kind: "legal_fee", charge_at: "signing", selection: "included", tier_group: null, selected: true, description: null, quantity: 1, sort_index: 0 };
  return [
    { ...base, id: "a", label: "Enhanced package (2 classes)", selection: "tier_option", tier_group: "Enhanced", unit_amount_cents: 325_000 },
    { ...base, id: "b", label: "USPTO filing fees", kind: "government_fee", charge_at: "filing", selection: "tier_option", tier_group: "Enhanced", quantity: 2, unit_amount_cents: 35_000 },
  ];
}

function signed(quoteId: string, acceptedAt: string, readable = true): SignedQuoteForLoe {
  return {
    quoteId,
    reference: `QT-${quoteId.slice(0, 6).toUpperCase()}`,
    title: "Trademark filing",
    acceptedAt,
    snapshot: readable
      ? buildAcceptedSnapshot({
          view: { title: "Filing", introBody: null, termsBody: null, expiresAt: null, currency: "USD" },
          lines: lines(),
          acceptedAt,
          name: "Nadia Petra",
          email: "nadia@example.com",
        })
      : null,
  };
}

async function render(search: { quote?: string } = {}): Promise<string> {
  const element = await Page({ params: Promise.resolve({ matterId: MATTER_ID }), searchParams: Promise.resolve(search) });
  return renderToStaticMarkup(element);
}

/** Every template radio on the page, as its own tag, whatever order React writes the attributes in. */
function variantRadios(html: string): string[] {
  return html.match(/<input[^>]*name="variant"[^>]*>/g) ?? [];
}

function ok(...quotes: SignedQuoteForLoe[]): SignedQuotesLoad {
  return { status: "ok", quotes };
}

beforeEach(() => {
  h.load = ok();
  h.role = "attorney";
  h.modules = ["document-center"];
  h.moduleCalls = 0;
  h.loadCalls = 0;
});

describe("engagement letter page — the module gate", () => {
  it("404s a firm without the Document Center before reading any signed quote", async () => {
    h.modules = [];
    h.load = ok(signed(Q1, "2026-09-27T15:00:00Z"));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.moduleCalls).toBe(1);
    expect(h.loadCalls).toBe(0);
  });

  it("checks the module itself, not only through the segment layout", async () => {
    await render();
    expect(h.moduleCalls).toBe(1);
  });
});

describe("engagement letter page — no signed quote", () => {
  it("is the blank form it has always been", async () => {
    const html = await render();
    expect(html).toContain("New letter of engagement");
    expect(html).toContain('name="packageName"');
    expect(html).not.toContain("Pre-filled from the signed quote");
    expect(html).not.toContain('name="quoteId"');
    expect(html).not.toContain("signed quote");
    // The mark and package defaults the blank form always took from the matter.
    expect(html).toContain('value="HALCYON ROWE"');
    expect(html).toContain('value="Enhanced"');
    expect(html).toContain('name="amountPaid"');
    expect(html).not.toContain('value="$3,250"');
    expect(html).not.toContain('name="govFeesText"');
  });

  it("does not claim a default template, and the choice is not pre-selected", async () => {
    const html = await render();
    expect(html).not.toMatch(/default for new clients/i);
    expect(html).toContain("Template — required, never guessed");
    expect(variantRadios(html)).toHaveLength(2);
    expect(variantRadios(html).some((tag) => tag.includes("checked"))).toBe(false);
  });
});

describe("engagement letter page — one signed quote", () => {
  beforeEach(() => {
    h.load = ok(signed(Q1, "2026-09-28T02:30:00.000Z"));
  });

  it("opens pre-filled, with the note, the date in the firm's zone, and a link to the quote", async () => {
    const html = await render();
    expect(html).toContain("Pre-filled from the signed quote");
    expect(html).toContain("From signed quote");
    expect(html).toContain("QT-3F9A1C");
    expect(html).toContain("on Sep 27, 2026");
    // (The app serves a trailing slash; Link adds it from next.config, which a bare render doesn't load.)
    expect(html).toContain(`href="/dashboard/quotes/${Q1}`);
    expect(html).toContain("signed by Nadia Petra");
    expect(html).toContain("not re-priced");
  });

  it("fills the form from the signed record and carries the quote id", async () => {
    const html = await render();
    expect(html).toContain(`<input type="hidden" name="quoteId" value="${Q1}"/>`);
    expect(html).toContain('name="packageName"');
    expect(html).toContain('value="Enhanced"');
    expect(html).toContain('name="classCount"');
    expect(html).toMatch(/name="classCount"[^>]*value="2"/);
    expect(html).toMatch(/name="amountPaid"[^>]*value="\$3,250"/);
    expect(html).toMatch(/name="govFeesText"[^>]*value="\$700 \(350 × 2 classes\)"/);
    expect(html).toContain("Enhanced package (2 classes) — $3,250");
    expect(html).toMatch(/name="clientName"[^>]*value="Nadia Petra"/);
    expect(html).toContain("$3,250 due at signing");
    expect(html).toContain("$700 due at filing");
  });

  it("never pre-selects the template, and says the choice is the firm's", async () => {
    const html = await render();
    const radios = variantRadios(html);
    expect(radios).toHaveLength(2);
    expect(radios.every((tag) => tag.includes("required") && !tag.includes("checked"))).toBe(true);
    expect(radios.map((tag) => /value="(\w+)"/.exec(tag)?.[1])).toEqual(["current", "legacy"]);
    expect(html).toContain("The template is yours to choose");
  });

  it("shows the note without a link for a role that cannot open the quote page", async () => {
    h.role = "paralegal";
    const html = await render();
    expect(html).toContain("QT-3F9A1C");
    expect(html).not.toContain(`/dashboard/quotes/${Q1}/`);
  });

  it("offers filling it in by hand, but no picker when there is only one quote", async () => {
    const html = await render();
    expect(html).toContain("Fill it in by hand instead");
    expect(html).not.toContain("Use a different signed quote");
  });

  it("ignores a quote id that isn't a signed quote on this matter, and says so", async () => {
    const html = await render({ quote: "someone-elses" });
    expect(html).toContain("isn&#x27;t a signed quote on this matter, so it was ignored");
    expect(html).toContain("Pre-filled from the signed quote");
  });

  it("?quote=none is the blank form, with a way back", async () => {
    const html = await render({ quote: "none" });
    expect(html).toContain("Filling this in by hand");
    expect(html).toContain(`?quote=${Q1}`);
    expect(html).not.toContain('name="quoteId"');
    expect(html).not.toContain("Pre-filled from the signed quote");
  });
});

describe("engagement letter page — several signed quotes", () => {
  beforeEach(() => {
    h.load = ok(signed(Q1, "2026-09-28T02:30:00.000Z"), signed(Q2, "2026-08-02T15:00:00.000Z"));
  });

  it("makes staff choose: a picker and no form, nothing guessed", async () => {
    const html = await render();
    expect(html).toContain("This matter has 2 signed quotes");
    expect(html).toContain("QT-3F9A1C");
    expect(html).toContain("QT-7BE0D2");
    expect(html).toContain(`?quote=${Q1}`);
    expect(html).toContain(`?quote=${Q2}`);
    expect(html).not.toContain("<form");
    expect(html).not.toContain('name="packageName"');
    expect(html).toContain("Fill it in by hand instead");
  });

  it("pre-fills from the one staff chose, and offers the others", async () => {
    const html = await render({ quote: Q2 });
    expect(html).toContain("QT-7BE0D2");
    expect(html).toContain("on Aug 2, 2026");
    expect(html).toContain(`name="quoteId" value="${Q2}"`);
    expect(html).toContain("Use a different signed quote");
  });

  it("lists a quote with no readable signed copy, but does not offer it", async () => {
    h.load = ok(signed(Q1, "2026-09-28T02:30:00.000Z"), signed(Q2, "2026-08-02T15:00:00.000Z", false));
    const html = await render();
    expect(html).toContain("no readable signed copy is stored");
    expect(html).not.toContain(`?quote=${Q2}`);
  });
});

describe("engagement letter page — a signed quote with no readable signed copy", () => {
  it("says so, never builds from the live lines, and leaves the blank form", async () => {
    h.load = ok(signed(Q1, "2026-09-28T02:30:00.000Z", false));
    const html = await render();
    expect(html).toContain("has no readable signed copy stored");
    expect(html).toContain("never built from the");
    expect(html).not.toContain('name="quoteId"');
    expect(html).toContain('name="packageName"');
    expect(html).not.toContain('value="$3,250"');
  });
});

describe("engagement letter page — the read fails", () => {
  it("says it could not check — not that there is no signed quote — and keeps the blank form usable", async () => {
    h.load = { status: "unavailable" };
    const html = await render();
    expect(html).toContain("couldn&#x27;t check whether this matter has a signed quote");
    expect(html).toContain("does not mean there isn&#x27;t one");
    expect(html).not.toContain('name="quoteId"');
    expect(html).toContain('name="packageName"');
  });

  it("says quotes aren't set up where the tables are missing", async () => {
    h.load = { status: "unconfigured" };
    const html = await render();
    expect(html).toContain("Quotes aren&#x27;t switched on for your firm yet");
    expect(html).toContain('name="packageName"');
  });
});
