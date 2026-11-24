import { describe, expect, it } from "vitest";
import { decideTopCard } from "@/lib/lead-step/decide";
import { readDid } from "@/lib/lead-step/did";
import { nextAction, recordingWaiting } from "@/lib/lead-step/next-actions";
import { nextRunWindow } from "@/lib/lead-step/schedule";
import { buildLeadStepView } from "@/lib/lead-step/view-model";
import { AGENT_ACTOR } from "@/lib/stage-keeper/moves";
import * as W from "@/lib/ui/words";
import { LEAD, NOW, RAYN, THURSDAY_CONSULT, draft, facts, jobsOn, pending, proposal, row } from "./fixtures";

const noMarkers = { preppedEventIds: [], handledMeetingIds: [], outcomeLogged: false };
const meeting = (startedAt: string) => ({ id: "m-1", provider: "zoom", title: "Strategy session", startedAt, durationSeconds: 2700, hasMaterial: true });

describe("the timeline cap is never read as complete", () => {
  it("the did-list says when it was cut short", () => {
    const v = buildLeadStepView(facts({ activity: { status: "ok", value: { rows: [], truncated: true } } })).did;
    expect(v).toEqual({ status: "ok", rows: [], note: W.LEAD_STEP_DID_CUT });
    expect(buildLeadStepView(facts()).did).toEqual({ status: "ok", rows: [], note: null });
  });
});

describe("the post-consult look-back is measured from the run, not the page", () => {
  it("a call 14 days before NOW but over 14 days before the next run is not promised", () => {
    const w = nextRunWindow("agents", new Date(NOW))!;
    // 13.9 days before now, 14.7 days before the end of tomorrow's run window.
    const edge = meeting("2026-11-03T18:00:00.000Z");
    expect(recordingWaiting([edge], noMarkers, w, new Date(NOW))).toBeNull();
    expect(nextAction(facts({ meetings: { status: "ok", value: [edge] } }))).toEqual({ status: "none" });
    const inside = meeting("2026-11-05T18:00:00.000Z");
    expect(recordingWaiting([inside], noMarkers, w, new Date(NOW))?.id).toBe("m-1");
  });

  it("the promise is worded as 'if it fits', never as a certain draft", () => {
    expect(W.leadStepProposalFromRecording("Tomorrow", "5 AM", "6 AM")).toContain("drafts the proposal if it fits");
    expect(W.leadStepProposalAfterConsult("Fri, Nov 20", "5 AM", "6 AM")).toContain("drafts the proposal if it fits");
  });
});

describe("the follow-up gap", () => {
  it("past the last day, or after day 7: the window has passed, never 'day 12 of 7'", () => {
    const old = proposal({ sentAt: "2026-11-05T16:00:00.000Z", expiresOn: "2026-11-12" });
    const v = buildLeadStepView(facts({ proposal: { status: "ok", value: old } })).top;
    expect(v).toMatchObject({ kind: "not-prepared", title: W.LEAD_STEP_FOLLOW_UP_PASSED, text: W.LEAD_STEP_FOLLOW_UP_PASSED_TEXT });
    expect(JSON.stringify(v)).not.toMatch(/of 7/);
    const noExpiry = proposal({ sentAt: "2026-11-05T16:00:00.000Z", expiresOn: null });
    expect(decideTopCard(facts({ proposal: { status: "ok", value: noExpiry } }))).toMatchObject({ gap: { id: "follow-up", windowPassed: true } });
  });

  it("with the morning brief's stalled-lead follow-up on, it says that one may still come; off, it doesn't", () => {
    const on = facts({ proposal: { status: "ok", value: proposal() }, jobs: { status: "ok", value: jobsOn({ settings: { "morning-brief": { enabled: true, autonomy: "draft" } } }) } });
    expect(buildLeadStepView(on).top).toMatchObject({ text: `${W.LEAD_STEP_GAP["follow-up"]} ${W.LEAD_STEP_STALLED_MAY_DRAFT}` });
    const off = facts({ proposal: { status: "ok", value: proposal() } });
    expect(buildLeadStepView(off).top).toMatchObject({ text: W.LEAD_STEP_GAP["follow-up"] });
    const unknown = facts({ proposal: { status: "ok", value: proposal() }, jobs: { status: "unavailable" } });
    expect(buildLeadStepView(unknown).top).toMatchObject({ text: `${W.LEAD_STEP_GAP["follow-up"]} ${W.LEAD_STEP_STALLED_MAY_DRAFT}` });
  });
});

describe("precedence: a known later step is never hidden", () => {
  it("jobs unknown with a consult booked and a later task: the task, with the next-step note", () => {
    const task = { id: "t-1", title: "Send the search report", type: "custom", dueAt: "2026-11-25T15:00:00.000Z", assigneeId: null, createdAt: NOW };
    const f = facts({ consult: { status: "ok", value: THURSDAY_CONSULT }, tasks: { status: "ok", value: [task] }, jobs: { status: "ok", value: jobsOn({ autopilot: "unknown" }) } });
    expect(decideTopCard(f)).toMatchObject({ kind: "yours", due: "later", nextUnknown: true });
    expect(buildLeadStepView(f).top).toMatchObject({ kind: "yours", note: W.LEAD_STEP_CANT_SHOW_NEXT });
    expect(buildLeadStepView(facts({ jobs: { status: "unavailable" }, consult: { status: "ok", value: THURSDAY_CONSULT }, tasks: { status: "ok", value: [task] } })).top).toMatchObject({ kind: "yours", note: W.LEAD_STEP_CANT_SHOW_NEXT });
  });

  it("the read-only wording names an approver, not an attorney", () => {
    expect(W.LEAD_STEP_NEEDS_AN_APPROVER).toBe("Needs an approver's yes");
    expect(W.LEAD_STEP_WAITING_ON_APPROVER).toBe("Waiting on an approver's yes");
  });
});

describe("settings a role may not be able to read", () => {
  it("unknown settings (an empty read for a non-admin role) promise nothing and say nothing is off", () => {
    const f = facts({ consult: { status: "ok", value: THURSDAY_CONSULT }, jobs: { status: "ok", value: jobsOn({ settings: null }) } });
    expect(nextAction(f)).toEqual({ status: "unknown" });
    expect(decideTopCard(f)).toEqual({ kind: "couldnt-load", what: "next" });
  });
});

describe("hand-offs on the card", () => {
  const members = [{ userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", role: "attorney" as const, displayName: "Rebecca" }, { userId: RAYN, role: "law_clerk" as const, displayName: "Rayn" }];
  const routing = { status: "ok" as const, routing: {}, members };
  it("handed to the viewer: 'Handed to you by', with Send back", () => {
    const d = draft({ handoff: { status: "ok", holder: { userId: RAYN, by: members[0].userId, note: null, at: NOW } } });
    const v = buildLeadStepView(facts({ approvals: pending(d), routing, viewer: { userId: RAYN, role: "law_clerk", actingAsStaff: false, canMoveStage: true } })).top;
    expect(v).toMatchObject({ handoff: { text: W.leadStepHandedToYou("Rebecca"), toViewer: true }, sendBack: true });
  });
  it("handed away by the viewer: 'Handed to Rayn', no Yes", () => {
    const d = draft({ handoff: { status: "ok", holder: { userId: RAYN, by: members[0].userId, note: null, at: NOW } } });
    const v = buildLeadStepView(facts({ approvals: pending(d), routing, viewer: { userId: members[0].userId, role: "attorney", actingAsStaff: false, canMoveStage: true } })).top;
    expect(v).toMatchObject({ handoff: { text: W.leadStepHandedTo("Rayn"), toViewer: false }, sendBack: false, actions: { yes: false }, blocked: W.LEAD_STEP_HANDED_AWAY });
  });
  it("an unknown hand-off state shows the card as today", () => {
    const v = buildLeadStepView(facts({ approvals: pending(draft()) })).top;
    expect(v).toMatchObject({ handoff: null, sendBack: false, actions: { yes: true } });
  });
});

describe("Undo", () => {
  const move = (payload: Record<string, unknown>) => row({ id: "r-1", type: "stage_changed", created_at: "2026-11-13T21:40:00.000Z", payload: { actor: AGENT_ACTOR, to_stage_id: "s-booked", to_stage: "Consult Scheduled", ...payload } });
  it("only for a move that recorded where it came from", () => {
    const without = readDid({ status: "ok", value: { rows: [move({})], truncated: false } }, LEAD, "s-booked");
    expect(without.status === "ok" && without.rows[0].undo).toBeNull();
    const withFrom = readDid({ status: "ok", value: { rows: [move({ from_stage_id: "s-new" })], truncated: false } }, LEAD, "s-booked");
    expect(withFrom.status === "ok" && withFrom.rows[0].undo?.state).toBe("available");
  });
  it("never for Lectual staff viewing as the firm", () => {
    const f = facts({ lead: { ...facts().lead, stageId: "s-booked" }, activity: { status: "ok", value: { rows: [move({ from_stage_id: "s-new" })], truncated: false } } });
    const staff = buildLeadStepView({ ...f, viewer: { ...f.viewer, actingAsStaff: true } }).did;
    expect(staff.status === "ok" && staff.rows[0].undo).toBeNull();
    const firm = buildLeadStepView(f).did;
    expect(firm.status === "ok" && firm.rows[0].undo).toEqual({ activityId: "r-1" });
  });
});
