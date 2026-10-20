import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

/**
 * One proposals surface (B5.1): the quotes LIST redirects for a firm holding
 * `proposals`; a firm without it keeps today's page. `redirect` throws in Next,
 * so the mock throws a sentinel the way the real one throws NEXT_REDIRECT.
 */

class Redirected extends Error {
  constructor(public to: string) {
    super(`redirect:${to}`);
  }
}

async function load(opts: { proposals: boolean; role: string | null }) {
  const redirect = vi.fn((to: string): never => {
    throw new Redirected(to);
  });
  vi.doMock("next/navigation", () => ({ redirect, notFound: vi.fn() }));
  vi.doMock("@/lib/org/modules", () => ({ orgHasModule: vi.fn(async (m: string) => m === "proposals" && opts.proposals) }));
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => (opts.role ? { kind: "ok", role: opts.role, org: { id: "o", name: "Firm", slug: "firm" }, user: { id: "u" } } : { kind: "none" })),
  }));
  vi.doMock("@/lib/quotes/load", () => ({
    loadQuotes: vi.fn(async () => ({ status: "ok", quotes: [] })),
    loadLinesForQuotes: vi.fn(async () => new Map()),
  }));
  vi.doMock("@/lib/quotes/clients", () => ({ quoteClientOptions: vi.fn(async () => []), quoteClientLabels: vi.fn(async () => new Map()) }));
  vi.doMock("@/lib/org/profile", () => ({ getFirmTimeZone: vi.fn(async () => "America/New_York") }));
  vi.doMock("@/components/quotes/QuoteForms", () => ({ NewQuoteForm: () => createElement("div", null, "new-quote-form") }));
  const { default: Page } = await import("../../src/app/dashboard/quotes/page");
  return { Page, redirect };
}

describe("/dashboard/quotes/ list", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it.each(["attorney", "intake"])("redirects a %s to /dashboard/proposals/ when the firm holds proposals", async (role) => {
    const { Page, redirect } = await load({ proposals: true, role });
    await expect(Page({ searchParams: Promise.resolve({ status: "sent" }) })).rejects.toMatchObject({ to: "/dashboard/proposals/" });
    expect(redirect).toHaveBeenCalledWith("/dashboard/proposals/");
  });

  it("without the module there is no redirect and the existing page renders", async () => {
    const { Page, redirect } = await load({ proposals: false, role: "attorney" });
    const html = renderToStaticMarkup(createElement("div", null, await Page({ searchParams: Promise.resolve({}) })));
    expect(redirect).not.toHaveBeenCalled();
    expect(html).toContain("Quotes &amp; proposals");
    expect(html).toContain("No quotes yet");
  });

  it("without the module the role gate still shows the restricted card below attorney", async () => {
    const { Page, redirect } = await load({ proposals: false, role: "intake" });
    const html = renderToStaticMarkup(createElement("div", null, await Page({ searchParams: Promise.resolve({}) })));
    expect(redirect).not.toHaveBeenCalled();
    expect(html).not.toContain("No quotes yet");
    expect(html).toContain("Restricted to the firm&#x27;s principals");
  });
});
