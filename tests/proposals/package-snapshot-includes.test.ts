/**
 * 2026-11-09 (seen in production): one brand-name save in the editor ran `withPackageSnapshot`, which rebuilt
 * `content.packages` from the firm's list. That list carries no `includes` rows, so every package lost its
 * "What each package includes" table, and the packages were reordered to the firm's order. The refresh now takes
 * only the PRICES from the firm's list and keeps the proposal's own rows and order.
 */
import { describe, it, expect } from "vitest";
import { withPackageSnapshot } from "@/lib/proposals/package-snapshot";
import { defaultSelection, quoteProposal } from "@/lib/proposals/pricing";
import type { PackageOffer, ProposalContent, ProposalInclude } from "@/lib/proposals/types";
import { danielle, ESSENTIAL, ENHANCED, CONCIERGE } from "./danielle-fixture";

const rows = (pkg: string): ProposalInclude[] => [
  { label: "Comprehensive search", included: pkg === "Essential" ? "Knockout only" : "Full", highlight: true },
  { label: "Office action responses", included: pkg === "Concierge" ? "Unlimited" : "1", note: "Non-final only" },
];

/** A proposal whose snapshot has each package's own rows, stored in the proposal's order (not the firm's). */
function withRows(order: PackageOffer[]): ProposalContent {
  const c = danielle();
  c.packages = order.map((p) => ({ ...p, includes: rows(p.package) }));
  return c;
}

/** The firm's list as `client_proposal_setting.pricing` holds it today: prices only, no `includes`. */
const FIRM = { packages: [ESSENTIAL, ENHANCED, CONCIERGE] };

describe("withPackageSnapshot keeps what belongs to the proposal", () => {
  it("includes survive a refresh", () => {
    const out = withPackageSnapshot(withRows([ESSENTIAL, ENHANCED, CONCIERGE]), FIRM);
    for (const p of out.packages ?? []) expect(p.includes).toEqual(rows(p.package));
    expect(out.packages?.every((p) => (p.includes ?? []).length === 2)).toBe(true);
  });

  it("the refreshed prices still come from the firm's list", () => {
    const firm = { packages: [{ ...ESSENTIAL, base_cents: 210_000 }, ENHANCED, CONCIERGE] };
    const out = withPackageSnapshot(withRows([ESSENTIAL, ENHANCED, CONCIERGE]), firm);
    expect(out.packages?.[0].base_cents).toBe(210_000);
    expect(out.packages?.[0].includes).toEqual(rows("Essential"));
  });

  it("the original order is kept", () => {
    const out = withPackageSnapshot(withRows([CONCIERGE, ESSENTIAL, ENHANCED]), FIRM);
    expect(out.packages?.map((p) => p.package)).toEqual(["Concierge", "Essential", "Enhanced"]);
    expect(out.packages?.[0].includes).toEqual(rows("Concierge"));
  });

  it("an entry the firm has since dropped keeps its place and its rows", () => {
    const out = withPackageSnapshot(withRows([ESSENTIAL, ENHANCED, CONCIERGE]), { packages: [ESSENTIAL, CONCIERGE] });
    expect(out.packages?.map((p) => p.package)).toEqual(["Essential", "Enhanced", "Concierge"]);
    expect(out.packages?.[1].includes).toEqual(rows("Enhanced"));
  });

  it("a package new to the proposal gets none, and is added after the proposal's own", () => {
    const PREMIER: PackageOffer = { ...CONCIERGE, package: "Premier", base_cents: 650_000 };
    const out = withPackageSnapshot(withRows([ENHANCED, ESSENTIAL]), { packages: [ESSENTIAL, ENHANCED, CONCIERGE, PREMIER] });
    expect(out.packages?.map((p) => p.package)).toEqual(["Enhanced", "Essential", "Concierge", "Premier"]);
    expect(out.packages?.[2].includes).toBeUndefined();
    expect(out.packages?.[3].includes).toBeUndefined();
    expect(out.packages?.[3]).toEqual(PREMIER);
  });

  it("a refresh against the same prices does not change what the client is quoted", () => {
    const c = withRows([CONCIERGE, ESSENTIAL, ENHANCED]);
    const out = withPackageSnapshot(c, FIRM);
    expect(quoteProposal(out, defaultSelection(out))).toEqual(quoteProposal(c, defaultSelection(c)));
  });

  it("refreshing twice is the same as once", () => {
    const once = withPackageSnapshot(withRows([CONCIERGE, ESSENTIAL, ENHANCED]), FIRM);
    expect(withPackageSnapshot(once, FIRM)).toEqual(once);
  });
});
