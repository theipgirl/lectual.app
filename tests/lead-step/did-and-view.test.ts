import { describe, expect, it } from "vitest";
import { readDid } from "@/lib/lead-step/did";
import { buildLeadStepView, viewerMayDecide, YES_HOLD_MS } from "@/lib/lead-step/view-model";
import { notSetUp, unavailable } from "@/lib/lead-step/facts";
import { AGENT_ACTOR } from "@/lib/stage-keeper/moves";
import { PREP_SOURCE } from "@/lib/agents/consult-prep/run";
import { ROLES, type Role } from "@/lib/auth/roles";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";
import * as W from "@/lib/ui/words";
import { LEAD, MERGED, NOW, RAYN, THURSDAY_CONSULT, draft, facts, jobsOn, proposal, row } from "./fixtures";

const move = (id: string, at: string, over: Record<string, unknown> = {}, leadId = LEAD) =>
  row({ id, lead_id: leadId, type: "stage_changed", created_at: at, payload: { actor: AGENT_ACTOR, from_stage_id: "s-new", to_stage_id: "s-booked", from_stage: "Potential New Client", to_stage: "Consult Scheduled", ...over } });

describe("What Lectual did", () => {
  it("lists the assistants' and the system's rows, newest first, and leaves a person's rows out", () => {
    const rows = [
      row({ id: "r-person", type: "note", actor_type: "user", created_at: "2026-11-17T12:00:00.000Z" }),
      row({ id: "r-prep", type: "queue_drafted", created_at: "2026-11-16T21:12:00.000Z", payload: { source: PREP_SOURCE, kind: "heads_up", event_id: "evt-1" } }),
      row({ id: "r-mail", type: "email_received", actor_type: "system", created_at: "2026-11-13T21:35:00.000Z" }),
      move("r-move", "2026-11-13T21:40:00.000Z"),
      row({ id: "r-review", type: "ai_insight", actor_type: "user", payload: { source: "stage-keeper-review" } }),
    ];
    const list = readDid({ status: "ok", value: rows }, LEAD, "s-booked");
    expect(list.status).toBe("ok");
    if (list.status !== "ok") return;
    expect(list.rows.map((r) => [r.id, r.text])).toEqual([
      ["r-prep", W.LEAD_STEP_DID_PREP_BRIEF],
      ["r-move", W.leadStepMoved("Consult Scheduled")],
      ["r-mail", W.LEAD_STEP_DID_FILED_IN],
    ]);
  });

  it("Undo only on the Stage Keeper's move, only on the lead's own rows, only while it can still be undone", () => {
    const own = move("r-own", "2026-11-13T21:40:00.000Z");
    const merged = move("r-merged", "2026-11-12T21:40:00.000Z", {}, MERGED);
    const drafted = row({ id: "r-draft", type: "queue_drafted", payload: { source: "morning-brief" } });
    const list = readDid({ status: "ok", value: [own, merged, drafted] }, LEAD, "s-booked");
    if (list.status !== "ok") throw new Error("expected ok");
    const byId = Object.fromEntries(list.rows.map((r) => [r.id, r.undo]));
    expect(byId["r-own"]).toEqual({ kind: "stage-move", activityId: "r-own", state: "available" });
    expect(byId["r-merged"]).toBeNull();
    expect(byId["r-draft"]).toBeNull();
    // Moved since: no Undo.
    const movedOn = readDid({ status: "ok", value: [own] }, LEAD, "s-elsewhere");
    if (movedOn.status !== "ok") throw new Error("expected ok");
    expect(movedOn.rows[0].undo?.state).toBe("moved-since");
  });

  it("a failed timeline read is 'couldn't load', never 'nothing yet'", () => {
    expect(readDid(unavailable(), LEAD, null)).toEqual({ status: "unavailable" });
    expect(buildLeadStepView(facts({ activity: unavailable() })).did).toEqual({ status: "unavailable", text: W.LEAD_STEP_DID_UNAVAILABLE });
  });

  it("the view offers Undo only to a role that may move stages", () => {
    const value = [move("r-own", "2026-11-13T21:40:00.000Z")];
    const lead = { ...facts().lead, stageId: "s-booked" };
    const can = buildLeadStepView(facts({ lead, activity: { status: "ok", value } })).did;
    const cannot = buildLeadStepView(facts({ lead, activity: { status: "ok", value }, viewer: { ...facts().viewer, canMoveStage: false } })).did;
    expect(can.status === "ok" && can.rows[0].undo).toEqual({ activityId: "r-own" });
    expect(cannot.status === "ok" && cannot.rows[0].undo).toBeNull();
  });
});

describe("the top card view", () => {
  it("needs-yes for an approver: Yes, Edit and Not this, held for 5 seconds", () => {
    const v = buildLeadStepView(facts({ approvals: { status: "ok", value: [draft()] } }));
    expect(v.top).toMatchObject({ kind: "needs-yes", eyebrow: W.LEAD_STEP_NEEDS_YES, actions: { yes: true, edit: true, notThis: true }, blocked: null, waitingOn: null, holdMs: YES_HOLD_MS });
    expect(v.readOnly).toBe(false);
    expect(v.facts.waiting).toMatchObject({ value: W.LEAD_STEP_WAIT_APPROVAL, sub: W.LEAD_STEP_YOUR_YES });
  });

  it("a viewer who cannot approve sees the same card read-only, with whose yes it waits on", () => {
    const v = buildLeadStepView(facts({ approvals: { status: "ok", value: [draft()] }, viewer: { ...facts().viewer, role: "viewer" } }));
    expect(v.top).toMatchObject({ kind: "needs-yes", actions: { yes: false, edit: false, notThis: false }, waitingOn: W.LEAD_STEP_WAITING_ON_APPROVER, eyebrow: W.LEAD_STEP_NEEDS_AN_APPROVER });
    expect(v.readOnly).toBe(true);
  });

  it("routed to a person: the card names them for everyone else", () => {
    const routing = { status: "ok" as const, routing: { stalled_followup: RAYN }, members: [{ userId: RAYN, role: "law_clerk" as Role, displayName: "Rayn" }] };
    const v = buildLeadStepView(facts({ approvals: { status: "ok", value: [draft()] }, routing, viewer: { ...facts().viewer, role: "paralegal" } }));
    expect(v.top).toMatchObject({ eyebrow: W.leadStepNeedsYesOf("Rayn"), waitingOn: W.leadStepWaitingOn("Rayn"), actions: { yes: false, edit: true } });
  });

  it("Yes is canApproveItem for every role x every kind the card can show", () => {
    const items = [
      draft({ id: "a" }), // stalled follow-up
      draft({ id: "b", agent: "post-consult", headline: "Post-consult email" }),
      draft({ id: "c", agent: "welcome-client", headline: "Welcome" }),
      draft({ id: "d", type: "ENGAGEMENT_LETTER", headline: "LOE" }),
      draft({ id: "e", type: "OPINION_LETTER", headline: "Opinion" }),
      draft({ id: "f", agent: "staff", headline: "Partnership follow-up" }),
      draft({ id: "g", agent: "someone", headline: "Something" }),
    ];
    for (const role of ROLES) {
      for (const item of items) {
        const f = facts({ approvals: { status: "ok", value: [item] }, viewer: { ...facts().viewer, role } });
        const v = buildLeadStepView(f);
        const may = viewerMayDecide(f, item);
        expect(v.top.kind === "needs-yes" && v.top.actions.yes, `${role} ${item.kind}`).toBe(may);
        if (item.attorneyOnly && !QUEUE_APPROVE_ROLES.includes(role)) expect(may, `${role} ${item.kind}`).toBe(false);
      }
    }
  });

  it("a law clerk sees no Yes on a post-consult email", () => {
    const item = draft({ agent: "post-consult", headline: "Post-consult email" });
    const v = buildLeadStepView(facts({ approvals: { status: "ok", value: [item] }, viewer: { ...facts().viewer, role: "law_clerk" } }));
    expect(v.top.kind === "needs-yes" && v.top.actions.yes).toBe(false);
  });

  it("text that reads as legal advice makes the item attorney-only: no Yes for a non-approver even when routed to them", () => {
    const routing = { status: "ok" as const, routing: { stalled_followup: RAYN }, members: [{ userId: RAYN, role: "law_clerk" as Role }] };
    const plain = draft();
    const advice = draft({ finalBody: "Hi Maya, your mark is likely to be registered." });
    const rayn = { userId: RAYN, role: "law_clerk" as Role, actingAsStaff: false, canMoveStage: true };
    expect(viewerMayDecide({ viewer: rayn, routing }, plain)).toBe(true);
    expect(viewerMayDecide({ viewer: rayn, routing }, advice)).toBe(false);
  });

  it("Lectual staff viewing as the firm: no Yes, the preview sentence", () => {
    const v = buildLeadStepView(facts({ approvals: { status: "ok", value: [draft()] }, viewer: { ...facts().viewer, actingAsStaff: true } }));
    expect(v.top).toMatchObject({ actions: { yes: false, edit: false, notThis: false }, blocked: W.LEAD_STEP_PREVIEW_ONLY });
  });

  it("a stale draft, a draft issue or a refused linked proposal: no Yes here, the reason instead", () => {
    const stale = buildLeadStepView(facts({ approvals: { status: "ok", value: [draft({ closerLook: ["stale"] })] } }));
    expect(stale.top).toMatchObject({ actions: { yes: false, notThis: true }, blocked: W.LEAD_STEP_CLOSER_LOOK });
    const unchecked = buildLeadStepView(facts({ approvals: { status: "ok", value: [draft({ closerLook: null })] } }));
    expect(unchecked.top).toMatchObject({ actions: { yes: false }, blocked: W.LEAD_STEP_CANT_CHECK });
    const linked = draft({
      closerLook: ["linked-proposal"],
      linked: { status: "ok", id: "p-1", version: 1, proposalStatus: "draft", clientName: "Maya", legalCents: 547000, govCents: 140000, errorCount: 0, gateRefusal: "Create the proposal's link first: open it, review it, and click Save and create link." },
    });
    const lv = buildLeadStepView(facts({ approvals: { status: "ok", value: [linked] } }));
    expect(lv.top).toMatchObject({ actions: { yes: false }, blocked: "Create the proposal's link first: open it, review it, and click Save and create link.", proposal: { href: "/dashboard/proposals/p-1/" } });
  });

  it("has-it says what it waits for and what it does, and when, in the firm's zone", () => {
    const v = buildLeadStepView(facts({ consult: { status: "ok", value: THURSDAY_CONSULT } }));
    expect(v.top).toEqual({
      kind: "has-it",
      eyebrow: W.LEAD_STEP_HAS_IT,
      waitingFor: W.leadStepWaitingForConsult("Thu, Nov 19, 2:00 PM"),
      line: W.leadStepPrepPromise("Thu, Nov 19", "5 AM", "6 AM", true),
    });
    expect(v.facts.waiting).toMatchObject({ value: W.LEAD_STEP_WAIT_LECTUAL });
  });

  it("couldn't load: a fixed sentence, and Waiting on says so too", () => {
    const v = buildLeadStepView(facts({ approvals: unavailable() }));
    expect(v.top).toEqual({ kind: "couldnt-load", text: W.LEAD_STEP_CANT_SHOW_NEEDS });
    expect(v.facts.waiting).toMatchObject({ value: W.LEAD_STEP_COULDNT_LOAD, state: "unavailable" });
  });

  it("not prepared names the gap and the day", () => {
    const v = buildLeadStepView(facts({ proposal: { status: "ok", value: proposal() } }));
    expect(v.top).toMatchObject({ kind: "not-prepared", title: W.leadStepFollowUpDay(2), text: W.LEAD_STEP_GAP["follow-up"] });
  });

  it("approvals off: the switched-on sentence", () => {
    expect(buildLeadStepView(facts({ approvals: notSetUp("queue-off") })).top).toMatchObject({ kind: "approvals-off", text: W.LEAD_STEP_APPROVALS_OFF });
  });
});

describe("the four facts", () => {
  it("last contact: whose turn, from the lead's own timestamps", () => {
    expect(buildLeadStepView(facts()).facts.contact).toMatchObject({ value: "Nov 17", sub: `${W.LEAD_STEP_THEY_WROTE} · ${W.OUR_TURN}` });
  });
  it("no contact with Mailboxes off says so, never 'no contact yet'", () => {
    const f = facts({ lead: { ...facts().lead, lastInboundAt: null }, jobs: { status: "ok", value: jobsOn({ modules: { mailbox: false, proposals: true, agentToolkit: true } }) } });
    expect(buildLeadStepView(f).facts.contact).toMatchObject({ value: W.LEAD_STEP_CONTACT_OFF, state: "off" });
  });
  it("consult: booked, held, couldn't load", () => {
    expect(buildLeadStepView(facts({ consult: { status: "ok", value: THURSDAY_CONSULT } })).facts.consult.value).toBe("Thu, Nov 19, 2:00 PM");
    expect(buildLeadStepView(facts({ consult: unavailable() })).facts.consult).toMatchObject({ value: W.LEAD_STEP_COULDNT_LOAD, state: "unavailable" });
    expect(buildLeadStepView(facts()).facts.consult.value).toBe(W.LEAD_STEP_NOT_BOOKED);
  });
  it("proposal: hidden with Proposals off; opens and paid that failed are never 'not opened' or 'not paid'", () => {
    expect(buildLeadStepView(facts({ proposal: notSetUp("proposals-off") })).facts.proposal).toBeNull();
    expect(buildLeadStepView(facts({ proposal: unavailable() })).facts.proposal).toMatchObject({ value: W.LEAD_STEP_COULDNT_LOAD });
    const opens = buildLeadStepView(facts({ proposal: { status: "ok", value: proposal({ opens: { status: "unavailable" } }) } })).facts.proposal;
    expect(opens?.value).not.toMatch(/not opened/i);
    expect(opens?.state).toBe("unavailable");
    const paid = buildLeadStepView(facts({ proposal: { status: "ok", value: proposal({ status: "accepted", paid: { status: "unavailable" } }) } })).facts.proposal;
    expect(paid?.sub).toBe(W.LEAD_STEP_PAID_UNAVAILABLE);
    expect(buildLeadStepView(facts({ proposal: { status: "ok", value: proposal() } })).facts.proposal).toMatchObject({ value: "Link live, opened 2 times", sub: W.leadStepLastDay("Nov 22") });
  });
  it("the page draws the facts as of the instant they were read", () => {
    expect(facts().now).toBe(NOW);
  });
});
