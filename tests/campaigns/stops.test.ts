import { describe, it, expect } from "vitest";
import {
  NO_FACTS,
  clientFact,
  enrollRefusal,
  staleHeadline,
  staleSince,
  stopFor,
  stopLine,
  type StopFacts,
} from "@/lib/campaigns/stops";
import { describeActivity } from "@/components/leads/describe";

const facts = (over: Partial<StopFacts>): StopFacts => ({ ...NO_FACTS, ...over });
const ENROLLED = "2026-10-01T12:00:00Z";

describe("stopFor — what ends a sequence (intake SOP rule 1)", () => {
  it("nothing recorded, nothing stops", () => {
    expect(stopFor(NO_FACTS, ENROLLED)).toBeNull();
  });

  it("client facts stop it whenever they happened, strongest first: signed > paid > matter > won stage", () => {
    expect(stopFor(facts({ signedAt: "2026-09-01T00:00:00Z", paidAt: "2026-10-02T00:00:00Z" }), ENROLLED)).toEqual({ reason: "signed", at: "2026-09-01T00:00:00Z" });
    expect(stopFor(facts({ paidAt: "2026-10-02T03:00:00Z", wonAt: "2026-10-02T04:00:00Z" }), ENROLLED)?.reason).toBe("paid");
    expect(stopFor(facts({ matterOpenedAt: "2026-10-05T00:00:00Z" }), ENROLLED)?.reason).toBe("matter_opened");
    expect(stopFor(facts({ wonAt: "2026-08-01T00:00:00Z" }), ENROLLED)?.reason).toBe("client");
  });

  it("a reply or a call stops it only when it came after enrolling", () => {
    expect(stopFor(facts({ lastInboundAt: "2026-09-30T00:00:00Z" }), ENROLLED)).toBeNull();
    expect(stopFor(facts({ lastInboundAt: "2026-10-02T00:00:00Z" }), ENROLLED)?.reason).toBe("replied");
    expect(stopFor(facts({ lastMeetingAt: "2026-10-02T00:00:00Z", lastInboundAt: "2026-10-03T00:00:00Z" }), ENROLLED)?.reason).toBe("booked");
    expect(stopFor(facts({ lastMeetingAt: "2026-09-02T00:00:00Z" }), ENROLLED)).toBeNull();
  });

  it("an unreadable enrollment time errs towards stopping", () => {
    expect(stopFor(facts({ lastInboundAt: "2026-01-01T00:00:00Z" }), null)?.reason).toBe("replied");
  });

  it("clientFact ignores replies and calls", () => {
    expect(clientFact(facts({ lastInboundAt: "2026-10-02T00:00:00Z", lastMeetingAt: "2026-10-02T00:00:00Z" }))).toBeNull();
  });
});

describe("staleSince — the approval-time warning rule", () => {
  const QUEUED = "2026-10-03T14:00:00Z";
  it("names the client facts recorded AFTER the draft was queued", () => {
    expect(staleSince(facts({ signedAt: "2026-10-03T21:10:00Z", paidAt: "2026-10-04T02:00:00Z" }), QUEUED)).toEqual([
      { reason: "signed", at: "2026-10-03T21:10:00Z" },
      { reason: "paid", at: "2026-10-04T02:00:00Z" },
    ]);
  });
  it("a client fact from BEFORE the draft doesn't make it stale (it was written knowing that)", () => {
    expect(staleSince(facts({ signedAt: "2026-10-01T00:00:00Z" }), QUEUED)).toEqual([]);
  });
  it("uses the NEWEST of each client fact: a second payment after the draft is news", () => {
    expect(
      staleSince(facts({ paidAt: "2026-09-01T00:00:00Z", paidLatestAt: "2026-10-04T02:00:00Z" }), QUEUED),
    ).toEqual([{ reason: "paid", at: "2026-10-04T02:00:00Z" }]);
  });
  it("a reply since isn't a stale-draft fact — a follow-up often answers one", () => {
    expect(staleSince(facts({ lastInboundAt: "2026-10-04T00:00:00Z" }), QUEUED)).toEqual([]);
  });
  it("won stage and matter count as becoming a client", () => {
    expect(staleSince(facts({ wonAt: "2026-10-04T00:00:00Z", matterOpenedAt: "2026-10-04T01:00:00Z" }), QUEUED).map((f) => f.reason)).toEqual([
      "matter_opened",
      "client",
    ]);
  });
});

describe("the words", () => {
  it("Sequence stopped — signed quote, Oct 3 (in the firm's zone)", () => {
    expect(stopLine({ reason: "signed", at: "2026-10-03T21:10:00Z" }, "America/New_York")).toBe("Sequence stopped — signed quote, Oct 3");
    // 01:00 UTC on the 4th is still the 3rd in New York.
    expect(stopLine({ reason: "paid", at: "2026-10-04T01:00:00Z" }, "America/New_York")).toBe("Sequence stopped — payment recorded, Oct 3");
    expect(stopLine({ reason: null, at: null })).toBe("Sequence stopped");
  });
  it("Signed Oct 3 — the warning headline", () => {
    expect(staleHeadline({ reason: "signed", at: "2026-10-03T21:10:00Z" }, "America/New_York")).toBe("Signed Oct 3");
  });
  it("the enroll refusal says who, what and when", () => {
    expect(enrollRefusal("Dana Reyes", { reason: "signed", at: "2026-10-03T21:10:00Z" }, "America/New_York")).toBe(
      "Dana Reyes is already a client — signed a quote on Oct 3. Campaigns are for leads who haven't hired the firm, so nothing was enrolled.",
    );
  });
  it("the timeline names the stop's reason, and a lane override reads as an override", () => {
    expect(
      describeActivity({
        type: "drip_stopped",
        actor_type: "system",
        created_at: "2026-10-03T21:10:00Z",
        payload: { reason: "signed", sequence_name: "UGW nurture" },
      }),
    ).toMatchObject({ title: "Sequence stopped — signed quote", detail: "UGW nurture" });
    expect(
      describeActivity({
        type: "lead_updated",
        actor_type: "user",
        created_at: "2026-10-03T21:10:00Z",
        payload: { field: "lane", from: "warm", to: "hot", suggested: "cold", by: "Taylor" },
      }),
    ).toMatchObject({ title: "Lane set to Hot", detail: "by Taylor · was Warm · triage suggested Cold" });
  });
});
