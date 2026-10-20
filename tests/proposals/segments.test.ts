import { describe, it, expect } from "vitest";
import {
  PROPOSAL_SEGMENTS,
  inSegment,
  offeredPackages,
  outWithClientsCents,
  parseSegment,
  segmentFor,
  type OfferedPackage,
} from "@/lib/proposals/segments";
import { PROPOSAL_DISPLAY_KEYS } from "@/lib/proposals/display-status";
import { sevetri } from "./fixture";

const pkg = (legal: number, gov = 70_000, name = "Concierge"): OfferedPackage => ({ name, legalAtSigningCents: legal, usptoAtFilingCents: gov });

describe("segmentFor", () => {
  it("maps each display status to its segment; Closed is Everything only", () => {
    expect(segmentFor("sent")).toBe("out");
    expect(segmentFor("draft")).toBe("drafts");
    expect(segmentFor("blocked")).toBe("drafts");
    expect(segmentFor("accepted")).toBe("accepted");
    expect(segmentFor("expired")).toBe("expired");
    expect(segmentFor("closed")).toBe("everything");
  });

  it("every status is under Everything, and under exactly one other segment unless Closed", () => {
    for (const key of PROPOSAL_DISPLAY_KEYS) {
      expect(inSegment("everything", key)).toBe(true);
      const others = PROPOSAL_SEGMENTS.filter((s) => s !== "everything" && inSegment(s, key));
      expect(others).toHaveLength(key === "closed" ? 0 : 1);
    }
  });
});

describe("parseSegment", () => {
  it("accepts the five segment keys", () => {
    for (const s of PROPOSAL_SEGMENTS) expect(parseSegment(s)).toBe(s);
  });
  it("maps the older ?status= values onto segments", () => {
    expect(parseSegment("draft")).toBe("drafts");
    expect(parseSegment("approved")).toBe("drafts");
    expect(parseSegment("blocked")).toBe("drafts");
    expect(parseSegment("sent")).toBe("out");
    expect(parseSegment("accepted")).toBe("accepted");
    expect(parseSegment("expired")).toBe("expired");
    expect(parseSegment("closed")).toBe("everything");
    expect(parseSegment("withdrawn")).toBe("everything");
    expect(parseSegment("superseded")).toBe("everything");
    expect(parseSegment(" Sent ")).toBe("out");
  });
  it("is undefined for anything else", () => {
    for (const v of ["", "nope", "x'; drop", 4, null, undefined, ["sent"]]) expect(parseSegment(v)).toBeUndefined();
  });
});

describe("offeredPackages", () => {
  it("is one entry, with the legal and USPTO fees kept apart, when the package is named", () => {
    const content = sevetri();
    const [p, ...rest] = offeredPackages(content);
    expect(rest).toEqual([]);
    expect(p.name).toBe("Concierge");
    expect(p.legalAtSigningCents).toBeGreaterThan(0);
    expect(p.usptoAtFilingCents).toBeGreaterThan(0);
  });
  it("is none when the package name is blank (that row is blocked: 'no package offered yet')", () => {
    const content = sevetri();
    content.pricing.package = "   ";
    expect(offeredPackages(content)).toEqual([]);
  });
  it("is total: junk offers nothing and never throws", () => {
    for (const junk of [null, undefined, 4, "x", [], {}, { pricing: null }, { pricing: { package: 4 } }]) {
      expect(() => offeredPackages(junk)).not.toThrow();
      expect(offeredPackages(junk)).toEqual([]);
    }
  });
});

describe("outWithClientsCents", () => {
  it("sums the cheapest offered package's legal fee over Sent rows", () => {
    const out = outWithClientsCents([
      { displayKey: "sent", offered: [pkg(660_000)] },
      { displayKey: "sent", offered: [pkg(495_000), pkg(325_000, 70_000, "Enhanced"), pkg(195_000, 35_000, "Essential")] },
    ]);
    expect(out).toEqual({ status: "ok", cents: 660_000 + 195_000, count: 2 });
  });

  it("counts only Sent rows: Expired, Draft, Blocked, Accepted and Closed are excluded", () => {
    const out = outWithClientsCents([
      { displayKey: "sent", offered: [pkg(100_000)] },
      { displayKey: "expired", offered: [pkg(200_000)] },
      { displayKey: "draft", offered: [pkg(400_000)] },
      { displayKey: "blocked", offered: [pkg(800_000)] },
      { displayKey: "accepted", offered: [pkg(1_600_000)] },
      { displayKey: "closed", offered: [pkg(3_200_000)] },
    ]);
    expect(out).toEqual({ status: "ok", cents: 100_000, count: 1 });
  });

  it("never includes a USPTO fee", () => {
    const out = outWithClientsCents([{ displayKey: "sent", offered: [pkg(100_000, 9_999_999)] }]);
    expect(out).toEqual({ status: "ok", cents: 100_000, count: 1 });
  });

  it("a Sent row with no offered package adds 0 and still counts", () => {
    expect(outWithClientsCents([{ displayKey: "sent", offered: [] }, { displayKey: "sent", offered: [pkg(50_000)] }])).toEqual({ status: "ok", cents: 50_000, count: 2 });
  });

  it("nothing out is 0 of 0, a real answer", () => {
    expect(outWithClientsCents([])).toEqual({ status: "ok", cents: 0, count: 0 });
  });

  it("a failed read is unavailable, never 0", () => {
    expect(outWithClientsCents(null)).toEqual({ status: "unavailable" });
  });
});
