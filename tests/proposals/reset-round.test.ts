import { describe, it, expect } from "vitest";
import {
  currentRound,
  draftsInRound,
  paidStateFromEvents,
  roundStartedAt,
  stepStates,
  stepSucceeded,
  type StepEventInput,
} from "@/lib/proposals/paid";
import { runAcceptanceFollowups, type FollowupDb } from "@/lib/proposals/accept-followups";
import { acceptedSnapshot } from "./accepted-fixture";
import { fakeFollowupDb } from "./followup-db";

/**
 * lectual 0101: a reset starts a FRESH ROUND. Only step events after the version's newest
 * `reset` event count, so a second acceptance runs its follow-ups again and starts unpaid.
 */

const P = "prop-1";
const step = (s: string, outcome: string, at: string, proposal_id = P): StepEventInput => ({
  proposal_id,
  type: "edited",
  created_at: at,
  payload: { step: s, outcome },
});
const reset = (at: string, proposal_id = P): StepEventInput => ({ proposal_id, type: "reset", created_at: at, payload: {} });

describe("currentRound", () => {
  it("with no reset every event counts", () => {
    const events = [step("accept_notice", "sent", "2026-10-20T10:00:00Z")];
    expect(currentRound(events)).toEqual(events);
    expect(roundStartedAt(events)).toBeNull();
  });

  it("only events strictly after the NEWEST reset count, and the reset rows themselves are dropped", () => {
    const events = [
      step("accept_notice", "sent", "2026-10-20T10:00:00Z"),
      reset("2026-10-21T10:00:00Z"),
      step("lawmatics_note", "added", "2026-10-21T11:00:00Z"),
      reset("2026-10-22T10:00:00Z"),
      step("accept_notice", "sent", "2026-10-22T11:00:00Z"),
    ];
    expect(roundStartedAt(events)).toBe("2026-10-22T10:00:00Z");
    expect(currentRound(events).map((e) => e.created_at)).toEqual(["2026-10-22T11:00:00Z"]);
  });

  it("another version's reset never starts this version's round", () => {
    const events = [step("accept_notice", "sent", "2026-10-20T10:00:00Z"), reset("2026-10-21T10:00:00Z", "prop-other")];
    expect(stepSucceeded(events, P, "accept_notice")).toBe(true);
  });
});

describe("paid, steps and drafts follow the round", () => {
  it("a paid mark undone before a reset leaves the new round unpaid; a new mark after it is paid", () => {
    const before = [step("paid_marked", "marked", "2026-10-20T10:00:00Z"), step("paid_undone", "undone", "2026-10-20T11:00:00Z")];
    expect(paidStateFromEvents([...before, reset("2026-10-21T10:00:00Z")]).state).toBe("not_paid");
    expect(paidStateFromEvents([...before, reset("2026-10-21T10:00:00Z"), step("paid_marked", "marked", "2026-10-22T10:00:00Z")]).state).toBe("paid");
  });

  it("a paid mark from before a reset does not carry into the new round", () => {
    expect(paidStateFromEvents([step("paid_marked", "marked", "2026-10-20T10:00:00Z"), reset("2026-10-21T10:00:00Z")]).state).toBe("not_paid");
  });

  it("steps done in the earlier round are not done in the new one", () => {
    const events = [
      step("accept_notice", "sent", "2026-10-20T10:00:00Z"),
      step("lawmatics_note", "added", "2026-10-20T10:00:01Z"),
      step("loe_draft", "queued", "2026-10-20T12:00:00Z"),
      reset("2026-10-21T10:00:00Z"),
    ];
    for (const s of ["accept_notice", "lawmatics_note", "loe_draft"] as const) expect(stepSucceeded(events, P, s), s).toBe(false);
    expect(stepStates(events, P)).toEqual({});
  });

  it("an LOE draft from the earlier round doesn't count; one with no readable date is kept", () => {
    const drafts = [
      { id: "old", created_at: "2026-10-20T12:00:00Z" },
      { id: "new", created_at: "2026-10-22T12:00:00Z" },
      { id: "undated", created_at: null },
    ];
    expect(draftsInRound(drafts, null).map((d) => d.id)).toEqual(["old", "new", "undated"]);
    expect(draftsInRound(drafts, "2026-10-21T10:00:00Z").map((d) => d.id)).toEqual(["new", "undated"]);
  });
});

describe("acceptance follow-ups after a reset", () => {
  const snapshot = acceptedSnapshot({ classes: 1, marks: ["word"] });
  function world(events: Array<Record<string, unknown>>, failSelect?: (t: string) => boolean) {
    return fakeFollowupDb(
      {
        client_proposal: [
          { id: P, org_id: "org-1", family_id: "fam-1", status: "accepted", client_name: "Sevetri Wilson", client_email: null, lead_id: null, matter_id: null, accepted_snapshot: snapshot },
        ],
        client_proposal_setting: [{ org_id: "org-1", approver_user_ids: ["u-appr1"] }],
        crm_org_member: [{ org_id: "org-1", user_id: "u-appr1", role: "owner" }],
        crm_lead: [],
        crm_matter: [],
        client_proposal_event: events,
        crm_notification: [],
      },
      { failSelect },
    );
  }
  const noToken: (db: FollowupDb, orgId: string) => Promise<string | null> = async () => null;
  const earlier = [
    { org_id: "org-1", proposal_id: P, family_id: "fam-1", type: "edited", actor: "system", created_at: "2026-10-20T10:00:00Z", payload: { step: "accept_notice", outcome: "sent" } },
    { org_id: "org-1", proposal_id: P, family_id: "fam-1", type: "edited", actor: "system", created_at: "2026-10-20T10:00:01Z", payload: { step: "lawmatics_note", outcome: "added" } },
  ];

  it("without a reset, a second run repeats nothing (once per version, as before)", async () => {
    const { db, tables } = world([...earlier]);
    await runAcceptanceFollowups(db, { proposalId: P, orgId: "org-1" }, { getToken: noToken });
    expect(tables.crm_notification).toHaveLength(0);
    expect(tables.client_proposal_event).toHaveLength(2);
  });

  it("after a reset, the client's second acceptance notifies the firm again and tries the note again", async () => {
    const { db, tables } = world([
      ...earlier,
      { org_id: "org-1", proposal_id: P, family_id: "fam-1", type: "reset", actor: "staff", created_at: "2026-10-21T10:00:00Z", payload: { from: "accepted", to: "sent" } },
    ]);
    await runAcceptanceFollowups(db, { proposalId: P, orgId: "org-1" }, { getToken: noToken });
    expect(tables.crm_notification.map((r) => r.user_id)).toEqual(["u-appr1"]);
    const fresh = tables.client_proposal_event.slice(3).map((e) => (e.payload as Record<string, unknown>).step);
    expect(fresh).toEqual(["accept_notice", "lawmatics_note"]);
  });

  it("an unreadable reset history holds the Lawmatics note back, like any unreadable history", async () => {
    const { db, tables } = world([...earlier], (t) => t === "client_proposal_event");
    await runAcceptanceFollowups(db, { proposalId: P, orgId: "org-1" }, { getToken: noToken });
    const note = tables.client_proposal_event.find((e) => (e.payload as Record<string, unknown>)?.step === "lawmatics_note" && e.created_at !== "2026-10-20T10:00:01Z");
    expect((note?.payload as Record<string, unknown>).outcome).toBe("blocked");
  });
});
