import { describe, it, expect } from "vitest";
import {
  NON_SUCCESS_OUTCOMES,
  PROPOSAL_PAID_ROLES,
  PROPOSAL_STEPS,
  STEP_SUCCESS,
  describeStepEvent,
  isRetryableStep,
  paidStateFromEvents,
  readStep,
  stepActivityLabel,
  stepPayload,
  stepStates,
  stepSucceeded,
  type StepEventInput,
} from "@/lib/proposals/paid";
import { describeProposalEvent } from "@/lib/proposal-editor/events";
import { lastActivityLine, type ActivityEvent } from "@/lib/proposals/list-labels";
import { PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import type { ProposalEventRow } from "@/lib/proposals/types";

const ev = (step: string, outcome: string, at: string, extra: Partial<StepEventInput> = {}, reason?: string): StepEventInput => ({
  proposal_id: "p1",
  actor: "staff",
  actor_user_id: "u1",
  created_at: at,
  payload: { step, outcome, ...(reason ? { reason } : {}) },
  ...extra,
});

describe("PROPOSAL_PAID_ROLES", () => {
  it("is owner, admin, senior_admin and intake only", () => {
    expect([...PROPOSAL_PAID_ROLES].sort()).toEqual(["admin", "intake", "owner", "senior_admin"]);
  });
  it("is a subset of the roles the event policy lets write", () => {
    for (const r of PROPOSAL_PAID_ROLES) expect(PROPOSAL_STAFF_WRITE_ROLES).toContain(r);
    for (const r of ["paralegal", "attorney", "law_clerk", "viewer", "social_media", "clerk"]) expect(PROPOSAL_PAID_ROLES).not.toContain(r);
  });
});

describe("paidStateFromEvents", () => {
  const marked = ev("paid_marked", "marked", "2026-10-21T15:00:00Z");
  const undone = ev("paid_undone", "undone", "2026-10-21T16:00:00Z", { actor_user_id: "u2" });
  const markedAgain = ev("paid_marked", "marked", "2026-10-21T17:00:00Z", { actor_user_id: "u2" });

  it.each([
    ["no events", [], { state: "not_paid", undoneAt: null }],
    ["marked", [marked], { state: "paid", by: "u1", at: "2026-10-21T15:00:00Z" }],
    ["marked then undone", [marked, undone], { state: "not_paid", undoneAt: "2026-10-21T16:00:00Z" }],
    ["undone then marked", [undone, markedAgain].reverse(), { state: "paid", by: "u2", at: "2026-10-21T17:00:00Z" }],
    ["marked, undone, marked again", [marked, undone, markedAgain], { state: "paid", by: "u2", at: "2026-10-21T17:00:00Z" }],
    ["unordered input (newest first)", [markedAgain, undone, marked], { state: "paid", by: "u2", at: "2026-10-21T17:00:00Z" }],
    ["unordered input (shuffled)", [undone, markedAgain, marked], { state: "paid", by: "u2", at: "2026-10-21T17:00:00Z" }],
  ])("%s", (_name, events, expected) => {
    expect(paidStateFromEvents(events as StepEventInput[])).toEqual(expected);
  });

  it("ignores other steps, malformed payloads and a wrong outcome word", () => {
    const noise: StepEventInput[] = [
      ev("loe_draft", "queued", "2026-10-21T20:00:00Z"),
      { created_at: "2026-10-21T21:00:00Z", payload: null },
      { created_at: "2026-10-21T21:00:00Z", payload: "paid_marked" },
      { created_at: "2026-10-21T21:00:00Z", payload: ["paid_undone"] },
      { created_at: "2026-10-21T21:00:00Z", payload: { step: "paid_undone" } },
      { created_at: "2026-10-21T21:00:00Z", payload: { step: "paid_undone", outcome: "failed" } },
      { created_at: "2026-10-21T21:00:00Z", payload: { step: "nonsense", outcome: "undone" } },
      { created_at: "2026-10-21T21:00:00Z", payload: { fields: ["content"], changes: [] } },
    ];
    expect(paidStateFromEvents([marked, ...noise])).toMatchObject({ state: "paid", at: "2026-10-21T15:00:00Z" });
    expect(paidStateFromEvents(noise)).toEqual({ state: "not_paid", undoneAt: null });
  });

  it("two events at the same instant read as undone (Mark paid is then offered again)", () => {
    expect(paidStateFromEvents([marked, ev("paid_undone", "undone", "2026-10-21T15:00:00Z")]).state).toBe("not_paid");
    expect(paidStateFromEvents([ev("paid_undone", "undone", "2026-10-21T15:00:00Z"), marked]).state).toBe("not_paid");
  });

  it("reads Postgres timestamps with a space as well as ISO ones", () => {
    const pg = ev("paid_marked", "marked", "2026-10-21 15:00:00+00");
    expect(paidStateFromEvents([pg, ev("paid_undone", "undone", "2026-10-21T14:00:00Z")]).state).toBe("paid");
  });
});

describe("step vocabulary", () => {
  it("has eight steps, one success word each, and stepPayload builds the payload", () => {
    expect(PROPOSAL_STEPS).toHaveLength(8);
    for (const s of PROPOSAL_STEPS) expect(typeof STEP_SUCCESS[s]).toBe("string");
    expect(NON_SUCCESS_OUTCOMES).toEqual(["blocked", "failed", "skipped"]);
    expect(stepPayload("loe_draft", "queued", null, { queue_item_id: "q1" })).toEqual({ queue_item_id: "q1", step: "loe_draft", outcome: "queued" });
    expect(stepPayload("loe_draft", "blocked", "  Open the matter\n to draft the LOE.  ")).toEqual({ step: "loe_draft", outcome: "blocked", reason: "Open the matter to draft the LOE." });
    expect(stepPayload("loe_draft", "blocked", "x".repeat(900)).reason).toHaveLength(240);
  });

  it("readStep returns null for anything that is not a step event", () => {
    expect(readStep({ step: "loe_draft", outcome: "queued" })?.step).toBe("loe_draft");
    for (const bad of [null, undefined, 3, "s", [], {}, { step: "loe_draft" }, { step: "x", outcome: "y" }, { step: "loe_draft", outcome: "" }]) expect(readStep(bad)).toBeNull();
  });

  it("isRetryableStep names the five steps the page can run again", () => {
    for (const s of ["loe_draft", "accepted_file_upload", "custom_fields", "lawmatics_note", "loe_file_upload"]) expect(isRetryableStep(s)).toBe(true);
    for (const s of ["paid_marked", "paid_undone", "accept_notice", "x", null]) expect(isRetryableStep(s)).toBe(false);
  });

  it("stepStates keeps the newest event of each step for ONE proposal id", () => {
    const events: StepEventInput[] = [
      ev("loe_draft", "blocked", "2026-10-21T15:00:00Z", {}, "Open the matter to draft the LOE."),
      ev("loe_draft", "queued", "2026-10-21T16:00:00Z"),
      ev("loe_draft", "failed", "2026-10-21T17:00:00Z", { proposal_id: "other-version" }),
      ev("accepted_file_upload", "failed", "2026-10-21T16:30:00Z", {}, "HTTP 422"),
    ];
    const s = stepStates(events, "p1");
    expect(s.loe_draft?.outcome).toBe("queued");
    expect(s.accepted_file_upload).toMatchObject({ outcome: "failed", reason: "HTTP 422" });
    expect(s.custom_fields).toBeUndefined();
    expect(stepSucceeded(events, "p1", "loe_draft")).toBe(true);
    expect(stepSucceeded(events, "p1", "accepted_file_upload")).toBe(false);
    expect(stepSucceeded(events, "other-version", "loe_draft")).toBe(false);
  });
});

describe("the history in words (never 'edited')", () => {
  const row = (payload: Record<string, unknown>, over: Partial<ProposalEventRow> = {}): ProposalEventRow => ({
    id: "e1",
    org_id: "o",
    proposal_id: "p1",
    family_id: "f",
    type: "edited",
    actor: "staff",
    actor_user_id: "u1",
    payload,
    created_at: "2026-10-21T15:00:00Z",
    ...over,
  });
  const names = new Map([["u1", "Dawn"]]);

  it.each([
    [{ step: "paid_marked", outcome: "marked" }, "marked it paid by hand"],
    [{ step: "paid_undone", outcome: "undone" }, "undid the paid mark"],
    [{ step: "accept_notice", outcome: "sent" }, "sent the firm an in-app notice"],
    [{ step: "lawmatics_note", outcome: "added" }, "added a note to Lawmatics"],
    [{ step: "lawmatics_note", outcome: "blocked", reason: "more than one record matches" }, "didn’t add the acceptance note to Lawmatics: more than one record matches"],
    [{ step: "loe_draft", outcome: "queued" }, "queued the engagement letter draft for approval"],
    [{ step: "loe_draft", outcome: "blocked", reason: "Open the matter to draft the LOE." }, "didn’t draft the engagement letter: Open the matter to draft the LOE."],
    [{ step: "accepted_file_upload", outcome: "uploaded" }, "uploaded the accepted proposal to Lawmatics"],
    [{ step: "accepted_file_upload", outcome: "failed", reason: "HTTP 500" }, "couldn’t upload the accepted proposal to Lawmatics: HTTP 500"],
    [{ step: "loe_file_upload", outcome: "uploaded" }, "uploaded the approved engagement letter to Lawmatics"],
    [{ step: "custom_fields", outcome: "written" }, "wrote the LOE fields to the Lawmatics matter"],
    [{ step: "custom_fields", outcome: "skipped" }, "skipped the Lawmatics LOE fields"],
  ])("%j", (payload, what) => {
    const line = describeProposalEvent(row(payload), { names });
    expect(line.what).toContain(what);
    expect(line.what).not.toMatch(/^edited/);
    expect(line.who).toBe("Dawn");
  });

  it("the system steps are Lectual's, the client acceptance notice reads as a sentence", () => {
    const line = describeProposalEvent(row({ step: "accept_notice", outcome: "sent" }, { actor: "system", actor_user_id: null }), { names });
    expect(`${line.who} ${line.what}`).toBe("Lectual sent the firm an in-app notice that the client accepted");
  });

  it("an ordinary edit with no `step` still reads as before", () => {
    expect(describeProposalEvent(row({ fields: ["title"] }), { names }).what).toBe("edited title");
    expect(describeProposalEvent(row({}), { names }).what).toBe("edited the proposal");
  });

  it("describeStepEvent is null for a non-step payload", () => {
    expect(describeStepEvent({ fields: [] })).toBeNull();
    expect(describeStepEvent(null)).toBeNull();
  });
});

describe("the list's Last activity cell", () => {
  const NOW = Date.parse("2026-10-21T18:00:00Z");
  const base = { key: "accepted" as const, source: "manual" as const, updatedAt: "2026-10-21T14:00:00Z", acceptedAt: "2026-10-21T14:00:00Z", offeredCount: 1, blockingIssue: null, names: new Map([["u1", "Dawn"]]), now: NOW };
  const staff = (payload: unknown, at = "2026-10-21T15:00:00Z"): ActivityEvent => ({ type: "edited", actor: "staff", actor_user_id: "u1", created_at: at, payload });

  it("a paid mark reads 'Marked paid', never 'Edited'", () => {
    const line = lastActivityLine({ ...base, event: staff({ step: "paid_marked", outcome: "marked" }) });
    expect(line).toBe("Marked paid 3h ago · Dawn");
    expect(line).not.toMatch(/Edited/);
  });

  it.each([
    [{ step: "paid_undone", outcome: "undone" }, "Paid mark undone"],
    [{ step: "loe_draft", outcome: "queued" }, "Engagement letter queued"],
    [{ step: "loe_draft", outcome: "blocked" }, "Engagement letter not drafted"],
    [{ step: "accepted_file_upload", outcome: "failed" }, "Proposal not uploaded to Lawmatics"],
    [{ step: "loe_file_upload", outcome: "uploaded" }, "Engagement letter uploaded to Lawmatics"],
  ])("%j reads %s", (payload, label) => {
    expect(lastActivityLine({ ...base, event: staff(payload) })).toBe(`${label} 3h ago · Dawn`);
    expect(stepActivityLabel(payload)).toBe(label);
  });

  it("the system's own notice or note is not news: the acceptance stays the headline", () => {
    const system: ActivityEvent = { type: "edited", actor: "system", actor_user_id: null, created_at: "2026-10-21T15:00:00Z", payload: { step: "lawmatics_note", outcome: "added" } };
    expect(lastActivityLine({ ...base, event: system })).toBe("Accepted by the client · 4h ago");
  });

  it("an ordinary staff edit on a non-accepted row is still 'Edited', and a payload-less accepted event keeps the acceptance line", () => {
    expect(lastActivityLine({ ...base, key: "draft", event: staff(undefined) })).toBe("Edited 3h ago · Dawn");
    expect(lastActivityLine({ ...base, event: staff(undefined) })).toBe("Accepted by the client · 4h ago");
    expect(lastActivityLine({ ...base, event: "unavailable" })).toBe("Accepted by the client · 4h ago");
  });
});

describe("the consult agent's evidence reader is not confused by step events", () => {
  it("receipts come from the agent's own edited event, and step events (staff or system) are never read as evidence", async () => {
    const { buildProposalCard } = await import("@/lib/proposals/card");
    const { acceptedRow } = await import("./paid-flow-harness");
    const row = (id: string, actor: string, payload: Record<string, unknown>): ProposalEventRow => ({
      id,
      org_id: "o",
      proposal_id: "p1",
      family_id: "f",
      type: "edited",
      actor: actor as ProposalEventRow["actor"],
      actor_user_id: null,
      payload,
      created_at: "2026-10-21T15:00:00Z",
    });
    const steps = [row("e1", "staff", { step: "paid_marked", outcome: "marked" }), row("e2", "system", { step: "lawmatics_note", outcome: "added", source: "consult-proposal" })];
    expect(buildProposalCard(acceptedRow(), steps).receipts).toEqual({ status: "none" });
    const evidence = row("e3", "agent", { source: "consult-proposal", evidence: [{ quote: "a word mark and a logo", verified: true }], notes: "" });
    expect(buildProposalCard(acceptedRow(), [...steps, evidence]).receipts).toMatchObject({ status: "ok", verified: ["a word mark and a logo"] });
  });

  it("readConsultEvents asks only for agent edits, so a step event can never be returned by it", async () => {
    const source = (await import("node:fs")).readFileSync("src/lib/consult-proposal/link.ts", "utf8");
    expect(source).toMatch(/\.eq\("type", "edited"\)\s*\.eq\("actor", "agent"\)/);
  });
});
