import { describe, it, expect } from "vitest";
import { ROLES, type Role } from "@/lib/auth/roles";
import { canApproveQueue } from "@/lib/queue/roles";
import {
  QUEUE_KINDS,
  approvalRefusal,
  canApproveItem,
  classifyQueueItem,
  countsByPerson,
  eligibleOwners,
  filterByWho,
  flagsLegalAdvice,
  isAttorneyOnly,
  isAttorneyOnlyKind,
  ownerOf,
  parseApprovalRouting,
  parseWho,
  routingChoiceError,
  withApprovalRouting,
  type QueueKind,
} from "@/lib/queue/routing";
import { followup, MEMBERS, qitem, U } from "./routing-fixtures";

const SAMPLES: Record<QueueKind, ReturnType<typeof qitem>> = {
  stalled_followup: followup(),
  post_consult_email: qitem(),
  welcome_email: qitem({ agent: "welcome-client", headline: "Welcome Ana" }),
  engagement_letter: qitem({ agent: "document-center", type: "ENGAGEMENT_LETTER", headline: "LOE DRAFT — Ana — General" }),
  opinion_letter: qitem({ agent: "document-center", type: "OPINION_LETTER", headline: "Opinion letter DRAFT — Ana — ACME" }),
  internal_briefing: qitem({ agent: "morning-brief", type: "BRIEFING", headline: "Morning brief for Oct 28", recipient: null }),
  partnership_other: qitem({ agent: "staff", headline: "Partnership follow-up: Acme Co" }),
  client_email_other: qitem({ agent: "something-new", headline: "Hello" }),
};

describe("classifyQueueItem: one kind per item", () => {
  it.each(QUEUE_KINDS)("classifies the %s sample", (kind) => {
    expect(classifyQueueItem(SAMPLES[kind])).toBe(kind);
  });

  it("covers the other ways an item reaches a kind", () => {
    expect(classifyQueueItem(qitem({ agent: "inbox-summary", type: "BRIEFING", headline: "Inbox summary", recipient: null }))).toBe("internal_briefing");
    expect(classifyQueueItem(qitem({ agent: "consult-prep", type: "BRIEFING", headline: "Consult heads-up for Ana", recipient: null }))).toBe("internal_briefing");
    expect(classifyQueueItem(qitem({ type: "TRADEMARK_CLEARANCE", agent: "document-center", headline: "Clearance" }))).toBe("opinion_letter");
    // a proposal email queued by staff carries the client link
    const link = `https://p.example.com/p/${"a".repeat(40)}/`;
    expect(classifyQueueItem(qitem({ agent: "staff", headline: "Proposal for Ana", draft_body: `See ${link}` }))).toBe("post_consult_email");
  });

  it("an unknown agent or type lands on the conservative kind, which is attorney-only", () => {
    expect(classifyQueueItem(qitem({ agent: "mystery", type: "MYSTERY", headline: "?" }))).toBe("client_email_other");
    expect(classifyQueueItem(qitem({ agent: "filing-followup", headline: "Month 2 status update — ACME" }))).toBe("client_email_other");
    expect(isAttorneyOnlyKind("client_email_other")).toBe(true);
  });

  it("a stalled-lead headline from some other agent is not a routine follow-up", () => {
    expect(classifyQueueItem(qitem({ agent: "staff", headline: "Follow-up for a stalled lead: Bo" }))).toBe("client_email_other");
  });

  it("attorney-only kinds are exactly the five the spec names", () => {
    expect(QUEUE_KINDS.filter(isAttorneyOnlyKind).sort()).toEqual(["client_email_other", "engagement_letter", "opinion_letter", "post_consult_email"].sort());
  });
});

describe("flagsLegalAdvice makes any kind attorney-only", () => {
  it.each([
    "Your mark is likely to be registered without trouble.",
    "You should file the response by Friday.",
    "In my legal advice, abandon the application.",
    "Our office action response strategy is to argue.",
    "The chances of success are high.",
    "This is not infringing on their mark.",
  ])("flags: %s", (text) => expect(flagsLegalAdvice(text)).toBe(true));

  it.each(["Just checking in to see how your week is going.", "Thanks for the call. We will send the proposal.", "", null, undefined])("does not flag: %s", (text) => expect(flagsLegalAdvice(text)).toBe(false));

  it("a routine follow-up that reads as advice becomes attorney-only, and its routed owner is ignored", () => {
    const risky = followup({ draft_body: "You should file before the deadline." });
    expect(isAttorneyOnly(risky)).toBe(true);
    expect(ownerOf(risky, { stalled_followup: U.caitlyn })).toEqual({ kind: "default" });
    expect(canApproveItem({ role: "paralegal", userId: U.caitlyn, item: risky, routing: { stalled_followup: U.caitlyn } })).toBe(false);
    expect(canApproveItem({ role: "attorney", userId: U.rebecca, item: risky, routing: { stalled_followup: U.caitlyn } })).toBe(true);
  });
});

describe("parseApprovalRouting", () => {
  it("keeps valid entries", () => {
    expect(parseApprovalRouting({ stalled_followup: U.caitlyn, post_consult_email: U.rebecca }, MEMBERS)).toEqual({
      routing: { stalled_followup: U.caitlyn, post_consult_email: U.rebecca },
      dropped: 0,
    });
  });

  it("drops stale members, unknown kinds, bad values, viewers and an attorney-only kind routed to a paralegal, and counts them", () => {
    const raw = {
      stalled_followup: U.ghost, // not a member
      mystery_kind: U.caitlyn, // unknown kind
      welcome_email: "not-a-uuid",
      internal_briefing: U.viewer, // a viewer owns nothing
      engagement_letter: U.caitlyn, // paralegal on an attorney-only kind
      opinion_letter: U.taylor, // owner tier: fine
    };
    expect(parseApprovalRouting(raw, MEMBERS)).toEqual({ routing: { opinion_letter: U.taylor }, dropped: 5 });
  });

  it("nothing stored is an empty routing; a non-object is dropped", () => {
    expect(parseApprovalRouting(undefined, MEMBERS)).toEqual({ routing: {}, dropped: 0 });
    expect(parseApprovalRouting(["x"], MEMBERS)).toEqual({ routing: {}, dropped: 1 });
  });

  it("attorney-only kinds list only approver roles; others list every staff member and never a viewer", () => {
    expect(eligibleOwners("engagement_letter", MEMBERS).map((x) => x.userId).sort()).toEqual([U.rebecca, U.taylor].sort());
    expect(eligibleOwners("stalled_followup", MEMBERS).map((x) => x.userId).sort()).toEqual([U.rebecca, U.caitlyn, U.taylor].sort());
  });

  it("routingChoiceError gives a sentence for each refusal", () => {
    expect(routingChoiceError("stalled_followup", U.caitlyn, MEMBERS)).toBeNull();
    expect(routingChoiceError("nope", U.caitlyn, MEMBERS)).toMatch(/isn't one of the options/);
    expect(routingChoiceError("stalled_followup", U.ghost, MEMBERS)).toMatch(/isn't on your team/);
    expect(routingChoiceError("post_consult_email", U.caitlyn, MEMBERS)).toMatch(/attorney or an owner/);
    expect(routingChoiceError("welcome_email", U.viewer, MEMBERS)).toMatch(/can't go to Vic/);
  });

  it("withApprovalRouting replaces only that key", () => {
    expect(withApprovalRouting({ a: 1, approval_routing: { x: 1 } }, { welcome_email: U.caitlyn })).toEqual({ a: 1, approval_routing: { welcome_email: U.caitlyn } });
  });
});

describe("canApproveItem", () => {
  it("with no routing it is exactly the old rule for all 10 roles and every kind", () => {
    for (const role of ROLES) {
      for (const kind of QUEUE_KINDS) {
        expect(canApproveItem({ role, userId: "u", item: SAMPLES[kind], routing: {} }), `${role} ${kind}`).toBe(canApproveQueue(role));
      }
    }
  });

  it("a paralegal owner approves a routed stalled follow-up but never an attorney-only kind", () => {
    const routing = { stalled_followup: U.caitlyn, post_consult_email: U.caitlyn, engagement_letter: U.caitlyn, opinion_letter: U.caitlyn };
    const can = (item: ReturnType<typeof qitem>) => canApproveItem({ role: "paralegal", userId: U.caitlyn, item, routing });
    expect(can(SAMPLES.stalled_followup)).toBe(true);
    expect(can(SAMPLES.post_consult_email)).toBe(false);
    expect(can(SAMPLES.engagement_letter)).toBe(false);
    expect(can(SAMPLES.opinion_letter)).toBe(false);
  });

  it("someone who is not the owner and not the admin tier is refused; the admin tier overrides", () => {
    const routing = { stalled_followup: U.caitlyn };
    const item = SAMPLES.stalled_followup;
    expect(canApproveItem({ role: "attorney", userId: U.rebecca, item, routing })).toBe(false);
    expect(canApproveItem({ role: "intake", userId: "x", item, routing })).toBe(false);
    expect(canApproveItem({ role: "owner", userId: U.taylor, item, routing })).toBe(true);
    expect(canApproveItem({ role: "senior_admin", userId: "y", item, routing })).toBe(true);
  });

  it("an attorney-only kind routed to an attorney: only that attorney or the admin tier", () => {
    const routing = { post_consult_email: U.rebecca };
    const item = SAMPLES.post_consult_email;
    expect(canApproveItem({ role: "attorney", userId: U.rebecca, item, routing })).toBe(true);
    expect(canApproveItem({ role: "attorney", userId: "other-attorney", item, routing })).toBe(false);
    expect(canApproveItem({ role: "admin", userId: "a", item, routing })).toBe(true);
  });

  it("viewer, social_media and an unknown role can never approve anything", () => {
    for (const role of ["viewer", "social_media", null, undefined] as (Role | null | undefined)[]) {
      expect(canApproveItem({ role, userId: U.viewer, item: SAMPLES.stalled_followup, routing: { stalled_followup: U.viewer } })).toBe(false);
    }
  });

  it("refusal sentences", () => {
    const routing = { stalled_followup: U.caitlyn };
    expect(approvalRefusal({ role: "attorney", userId: U.rebecca, item: SAMPLES.stalled_followup, routing, members: MEMBERS })).toBe(
      "This one is for Caitlyn. Ask them to approve it, or an owner or admin.",
    );
    expect(approvalRefusal({ role: "paralegal", userId: U.caitlyn, item: SAMPLES.post_consult_email, routing, members: MEMBERS })).toBe("Only an attorney can approve this kind of message.");
    expect(approvalRefusal({ role: "paralegal", userId: U.caitlyn, item: SAMPLES.stalled_followup, routing, members: MEMBERS })).toBeNull();
  });
});

describe("routing a kind moves its items between the pills and changes who may approve (table)", () => {
  const items = [followup({ id: "f1" }), followup({ id: "f2" }), qitem({ id: "p1" })];
  const rows: [string, Record<string, string>, Record<string, number>, number][] = [
    // routing, count per person id, Caitlyn's mine
    ["no routing", {}, { [U.rebecca]: 3, [U.taylor]: 3 }, 0],
    ["follow-ups to Caitlyn", { stalled_followup: U.caitlyn }, { [U.caitlyn]: 2, [U.rebecca]: 1, [U.taylor]: 1 }, 2],
  ];
  it.each(rows)("%s", (_n, routing, expected, caitlynMine) => {
    const counts = countsByPerson(items, routing, MEMBERS, { userId: U.caitlyn, role: "paralegal" });
    for (const p of counts.people) expect(p.count, p.name).toBe(expected[p.userId]);
    expect(counts.mine).toBe(caitlynMine);
    expect(counts.everyone).toBe(3);
  });
});

describe("countsByPerson / filterByWho / parseWho", () => {
  const items = [followup({ id: "f1" }), followup({ id: "f2" }), qitem({ id: "p1" }), qitem({ id: "p2", agent: "welcome-client", headline: "Welcome" })];
  const routing = { stalled_followup: U.caitlyn };
  const rebecca = { userId: U.rebecca, role: "attorney" as Role };

  it("an unrouted item counts under every usual approver and under Everyone", () => {
    const c = countsByPerson(items, routing, MEMBERS, rebecca);
    expect(c.mine).toBe(2); // p1, p2 (the two follow-ups are Caitlyn's)
    expect(c.everyone).toBe(4);
    expect(c.people).toEqual([
      { userId: U.caitlyn, name: "Caitlyn", count: 2 },
      { userId: U.taylor, name: "Taylor", count: 2 },
    ]); // Vic (viewer) and Rebecca (the viewer herself) have no pill
  });

  it("a viewer's Mine is zero but Everyone is complete", () => {
    const c = countsByPerson(items, routing, MEMBERS, { userId: U.viewer, role: "viewer" });
    expect(c.mine).toBe(0);
    expect(c.everyone).toBe(4);
  });

  it("filters by me, a person and all", () => {
    const ids = (w: Parameters<typeof filterByWho>[1]) => filterByWho(items, w, routing, MEMBERS, rebecca).map((i) => i.id).sort();
    expect(ids({ kind: "me" })).toEqual(["p1", "p2"]);
    expect(ids({ kind: "person", userId: U.caitlyn })).toEqual(["f1", "f2"]);
    expect(ids({ kind: "all" })).toEqual(["f1", "f2", "p1", "p2"]);
  });

  it("parseWho: default Mine for someone who can hold work, Everyone otherwise; unknown values fall back", () => {
    expect(parseWho(undefined, { mineEnabled: true, members: MEMBERS })).toEqual({ kind: "me" });
    expect(parseWho(undefined, { mineEnabled: false, members: MEMBERS })).toEqual({ kind: "all" });
    expect(parseWho("me", { mineEnabled: false, members: MEMBERS })).toEqual({ kind: "all" });
    expect(parseWho("all", { mineEnabled: true, members: MEMBERS })).toEqual({ kind: "all" });
    expect(parseWho(U.caitlyn, { mineEnabled: true, members: MEMBERS })).toEqual({ kind: "person", userId: U.caitlyn });
    expect(parseWho("garbage", { mineEnabled: true, members: MEMBERS })).toEqual({ kind: "me" });
    expect(parseWho(U.ghost, { mineEnabled: true, members: MEMBERS })).toEqual({ kind: "me" });
  });
});
