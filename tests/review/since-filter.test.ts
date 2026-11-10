import { describe, expect, it } from "vitest";
import { applyReviewFilters, isOlderThanSince, olderHiddenCount, parseReviewParams, REVIEW_SINCE, reviewHref } from "@/lib/review/params";
import { reviewBuckets } from "@/lib/review/buckets";
import { row, TODAY } from "./fixtures";

const OLD = { date: "2026-01-15", type: "email_sent" as const };
const old = (over = {}) => row({ key: "old", nextStep: null, waiting: "client", lastContact: OLD, ...over });
const P = parseReviewParams({});

describe("since filter", () => {
  it("is 2026-02-01 and hides an untouched-since-January row by default", () => {
    expect(REVIEW_SINCE).toBe("2026-02-01");
    expect(isOlderThanSince(old())).toBe(true);
    expect(applyReviewFilters([old()], P, null)).toEqual([]);
  });

  it("boundary: 2026-02-01 stays, 2026-01-31 goes", () => {
    expect(isOlderThanSince(old({ lastContact: { date: "2026-02-01", type: "note" } }))).toBe(false);
    expect(isOlderThanSince(old({ lastContact: { date: "2026-01-31", type: "note" } }))).toBe(true);
  });

  it("a row never touched is hidden as older", () => {
    expect(isOlderThanSince(old({ lastContact: null }))).toBe(true);
  });

  it.each([
    ["an open next step", { nextStep: { id: "t", title: "Call", dueDate: null, assigneeId: null } }],
    ["an open USPTO deadline", { deadline: { dueDate: "2026-12-01", title: "OA" } }],
    ["a USPTO wait", { waiting: "uspto" as const }],
    ["a pending approval", { waiting: "approval" as const }],
    ["a live proposal", { proposalExpiry: { text: "x", expiresOn: "2026-11-20", expired: false } }],
    ["unreadable contact history", { contactKnown: false, lastContact: null }],
  ])("never hides a row with %s", (_n, over) => {
    const r = old(over);
    expect(isOlderThanSince(r)).toBe(false);
    expect(applyReviewFilters([r], P, null)).toEqual([r]);
  });

  it("an expired proposal is not a protection", () => {
    expect(isOlderThanSince(old({ proposalExpiry: { text: "x", expiresOn: "2026-10-01", expired: true } }))).toBe(true);
  });

  it("?since=all shows everything", () => {
    const all = parseReviewParams({ since: "all" });
    expect(all.since).toBe("all");
    expect(applyReviewFilters([old()], all, null)).toHaveLength(1);
  });

  it("counts: hidden count respects the other filters; buckets are built from the filtered rows", () => {
    const rows = [old({ key: "a", client: "A" }), old({ key: "b", client: "B", kind: "lead" }), row({ key: "c", client: "C" })];
    expect(olderHiddenCount(rows, P, null)).toBe(2);
    expect(olderHiddenCount(rows, { ...P, kind: "lead" }, null)).toBe(1);
    expect(olderHiddenCount(rows, parseReviewParams({ since: "all" }), null)).toBe(2);
    expect(reviewBuckets(applyReviewFilters(rows, P, null), TODAY).total).toBe(1);
    expect(reviewBuckets(applyReviewFilters(rows, { ...P, since: "all" }, null), TODAY).total).toBe(3);
  });

  it("chip hrefs keep the other params", () => {
    const p = parseReviewParams({ who: "mine", kind: "leads", q: "acme", view: "sheet" });
    expect(reviewHref({ ...p, since: "all" })).toBe("/dashboard/review/?who=mine&kind=leads&q=acme&since=all&view=sheet");
    expect(reviewHref({ ...p, since: "default" })).not.toContain("since");
    expect(reviewHref(P)).toBe("/dashboard/review/");
  });
});
