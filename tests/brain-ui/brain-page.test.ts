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
    expect(html).toContain("No brain entries yet");
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

    expect(html).toContain("Couldn&#x27;t load the firm brain");
    expect(html).toContain("connection refused");
    expect(html).not.toContain("No brain entries yet");
  });
});
