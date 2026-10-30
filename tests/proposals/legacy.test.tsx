import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LEGACY_PROPOSALS_BY_ORG, legacyProposalsFor } from "@/lib/proposals/legacy";
import { LegacyProposals } from "@/components/proposal-list/LegacyProposals";

const RPB = "11111111-1111-1111-1111-111111111111";

describe("earlier proposals (pages made before the builder)", () => {
  it("lists Sevetri's page for RPB with its link unchanged", () => {
    const items = legacyProposalsFor(RPB);
    expect(items.map((p) => p.url)).toEqual(["https://proposals.rpblawfirm.com/prosperall-ojvfsf5ivxlu/"]);
    const html = renderToStaticMarkup(<LegacyProposals items={items} />);
    expect(html).toContain('href="https://proposals.rpblawfirm.com/prosperall-ojvfsf5ivxlu/"');
    expect(html).toContain("Sevetri Wilson");
    expect(html).toContain("aren&#x27;t tracked here");
  });

  it("fails closed: another firm, no firm, or a malformed entry shows nothing", () => {
    expect(legacyProposalsFor("22222222-2222-2222-2222-222222222222")).toEqual([]);
    expect(legacyProposalsFor(null)).toEqual([]);
    expect(renderToStaticMarkup(<LegacyProposals items={[]} />)).toBe("");
  });

  it("every entry is an https page on a firm proposals domain", () => {
    for (const list of Object.values(LEGACY_PROPOSALS_BY_ORG)) {
      for (const p of list) expect(p.url).toMatch(/^https:\/\/proposals\.[a-z0-9.-]+\/[a-z0-9-]+\/$/);
    }
  });
});
