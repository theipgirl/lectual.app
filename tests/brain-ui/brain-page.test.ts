import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { BrainEntry, ClaimEntry } from "@/lib/brain";

function entry(overrides: Partial<BrainEntry> = {}): BrainEntry {
  return {
    id: "entry-1",
    org_id: "org-1",
    category: "voice",
    key: "brand-voice-tone",
    title: "Brand voice — tone",
    body: "Warm, direct, no legalese.",
    data: null,
    created_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as BrainEntry;
}

function claim(overrides: Partial<ClaimEntry> = {}): ClaimEntry {
  return {
    id: "claim-1",
    org_id: "org-1",
    claim: "We file trademark applications in as little as 48 hours.",
    status: "proposed",
    context: "Homepage hero",
    notes: "",
    source: "consult",
    created_by: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as ClaimEntry;
}

/** Mocks resolveFirmSession() the way BrainPage reads the caller's role. */
function mockSessionWithRole(role: string) {
  vi.doMock("@/lib/firm/session", () => ({
    resolveFirmSession: vi.fn(async () => ({
      kind: "ok",
      role,
      org: { id: "org-1", name: "Test Firm", slug: "test-firm", modules: [] },
      user: { id: "user-1" },
      member: { role, org_id: "org-1" },
      isPlatformAdmin: false,
      actingAsStaff: false,
      switchableFirms: [],
      displayName: "Test User",
    })),
  }));
}

function mockBrainLib(entries: BrainEntry[], claims: ClaimEntry[]) {
  vi.doMock("@/lib/brain", () => ({
    listBrainEntries: vi.fn(async () => entries),
    listClaims: vi.fn(async () => claims),
    createBrainEntry: vi.fn(),
    updateBrainEntry: vi.fn(),
    deleteBrainEntry: vi.fn(),
    proposeClaim: vi.fn(),
    reviewClaim: vi.fn(),
    deleteClaim: vi.fn(),
  }));
}

describe("BrainPage", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renders brain entries, the claim library, and the disclaimer read-only for a non-admin", async () => {
    mockSessionWithRole("paralegal");
    mockBrainLib([entry()], [claim()]);

    const { default: BrainPage } = await import("../../src/app/dashboard/brain/page");
    const element = await BrainPage();
    const html = renderToStaticMarkup(element);

    // Brain entries, grouped by category
    expect(html).toContain("Brand voice");
    expect(html).toContain("brand-voice-tone");
    expect(html).toContain("Warm, direct, no legalese.");

    // Claim library, grouped by status
    expect(html).toContain("48 hours");
    expect(html).toContain("Proposed");

    // A non-admin, non-viewer role can propose but not manage entries or review claims
    expect(html).toContain("Propose a claim");
    expect(html).not.toContain("New entry");
    expect(html).not.toContain("Mark forbidden");
  });

  it("renders the New entry form and empty states for an admin with nothing recorded yet", async () => {
    mockSessionWithRole("senior_admin");
    mockBrainLib([], []);

    const { default: BrainPage } = await import("../../src/app/dashboard/brain/page");
    const element = await BrainPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain("New entry");
    expect(html).toContain("No firm notes yet");
    expect(html).toContain("No claims proposed yet");
  });

  it("shows claim review actions for an attorney but not a paralegal", async () => {
    mockSessionWithRole("attorney");
    mockBrainLib([], [claim()]);

    const { default: BrainPage } = await import("../../src/app/dashboard/brain/page");
    const element = await BrainPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Approve");
    expect(html).toContain("Mark forbidden");
  });

  it("renders entry Markdown as formatted content, with a plain-text preview and no literal marks", async () => {
    mockSessionWithRole("paralegal");
    mockBrainLib([entry({ body: "**bold**\n\n| A | B |\n|---|---|\n| 1 | 2 |" })], []);

    const { default: BrainPage } = await import("../../src/app/dashboard/brain/page");
    const html = renderToStaticMarkup(await BrainPage());

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).not.toContain("**");
    expect(html).not.toContain("|---|");
    // The collapsed line is plain text; the formatted entry sits inside the entry's <details>.
    const preview = html.match(/<p class="lx-brain-body">([^<]*)<\/p>/);
    expect(preview?.[1]).toContain("bold");
    const details = html.slice(html.indexOf('<details class="lx-brain-full">'));
    expect(details).toContain("Read full entry");
    expect(details.indexOf("<table>")).toBeGreaterThan(0);
  });

  it("keeps the raw Markdown in the edit textarea for an admin", async () => {
    mockSessionWithRole("owner");
    mockBrainLib([entry({ body: "**bold**\n\n| A | B |\n|---|---|\n| 1 | 2 |" })], []);

    const { default: BrainPage } = await import("../../src/app/dashboard/brain/page");
    const html = renderToStaticMarkup(await BrainPage());

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toMatch(/<textarea name="body"[^>]*>\*\*bold\*\*/);
    // No literal ** anywhere outside a textarea.
    const outside = html.replace(/<textarea[\s\S]*?<\/textarea>/g, "");
    expect(outside).not.toContain("**");
    expect(outside).not.toContain("|---|");
  });

  it("shows an honest error card, not an empty list, when the read fails", async () => {
    mockSessionWithRole("owner");
    vi.doMock("@/lib/brain", () => ({
      listBrainEntries: vi.fn(async () => {
        throw new Error("connection refused");
      }),
      listClaims: vi.fn(async () => []),
      createBrainEntry: vi.fn(),
      updateBrainEntry: vi.fn(),
      deleteBrainEntry: vi.fn(),
      proposeClaim: vi.fn(),
      reviewClaim: vi.fn(),
      deleteClaim: vi.fn(),
    }));

    const { default: BrainPage } = await import("../../src/app/dashboard/brain/page");
    const element = await BrainPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain("Couldn&#x27;t load your firm notes");
    expect(html).toContain(">Firm notes</h1>");
    expect(html).not.toContain("IP.OS");
    // The thrown message is a sentinel for database text: it is logged, never drawn.
    expect(html).not.toContain("connection refused");
    expect(html).toContain("Can&#x27;t show this right now. Refresh to try again.");
    expect(html).not.toContain("No firm notes yet");
  });
});
