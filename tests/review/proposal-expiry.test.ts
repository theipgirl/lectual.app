import { describe, it, expect } from "vitest";
import { expiringThisWeek, livePendingProposals, proposalExpiryTag } from "@/lib/review/proposal-expiry";

const TODAY = "2026-11-02";
const p = (over: Partial<{ family_id: string; version: number; status: string; expires_on: string | null }> = {}) => ({
  family_id: "f1", version: 1, status: "sent", expires_on: "2026-11-04", ...over,
});

describe("proposalExpiryTag", () => {
  it("is null with no proposals or no expiry", () => {
    expect(proposalExpiryTag([], TODAY)).toBeNull();
    expect(proposalExpiryTag([p({ expires_on: null })], TODAY)).toBeNull();
  });
  it("reads a future, same-day and past expiry", () => {
    expect(proposalExpiryTag([p()], TODAY)).toEqual({ text: "Proposal expires Nov 4", expiresOn: "2026-11-04", expired: false });
    expect(proposalExpiryTag([p({ expires_on: TODAY })], TODAY)?.text).toBe("Proposal expires today");
    expect(proposalExpiryTag([p({ expires_on: "2026-10-26" })], TODAY)).toMatchObject({ text: "Proposal expired Oct 26", expired: true });
  });
  it("only a sent newest version counts", () => {
    expect(proposalExpiryTag([p({ status: "accepted" })], TODAY)).toBeNull();
    expect(proposalExpiryTag([p({ status: "draft" }), p({ status: "approved" })], TODAY)).toBeNull();
    // v1 sent is superseded by a newer draft v2: no live tag
    expect(proposalExpiryTag([p({ version: 1 }), p({ version: 2, status: "draft" })], TODAY)).toBeNull();
    // older accepted/superseded versions never count when the newest is sent
    expect(proposalExpiryTag([p({ version: 1, status: "superseded", expires_on: "2026-10-01" }), p({ version: 2 })], TODAY)?.expiresOn).toBe("2026-11-04");
  });
  it("takes the earliest expiry across families", () => {
    const tag = proposalExpiryTag([p({ family_id: "a", expires_on: "2026-11-09" }), p({ family_id: "b", expires_on: "2026-11-03" })], TODAY);
    expect(tag?.expiresOn).toBe("2026-11-03");
    expect(livePendingProposals([p({ family_id: "a" }), p({ family_id: "b" })])).toHaveLength(2);
  });
});

describe("expiringThisWeek", () => {
  const tag = (d: string) => proposalExpiryTag([p({ expires_on: d })], TODAY);
  it("counts today..+6 and expired within 14 days", () => {
    expect(expiringThisWeek(tag(TODAY), TODAY)).toBe(true);
    expect(expiringThisWeek(tag("2026-11-08"), TODAY)).toBe(true);
    expect(expiringThisWeek(tag("2026-11-09"), TODAY)).toBe(false);
    expect(expiringThisWeek(tag("2026-10-19"), TODAY)).toBe(true);
    expect(expiringThisWeek(tag("2026-10-18"), TODAY)).toBe(false);
    expect(expiringThisWeek(null, TODAY)).toBe(false);
  });
});
