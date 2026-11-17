import { describe, expect, it } from "vitest";
import { cardItems, decideTopCard, dueState } from "@/lib/lead-step/decide";
import { notSetUp, unavailable, type OpenTask } from "@/lib/lead-step/facts";
import { GAP_FILLED_BY } from "@/lib/lead-step/gaps";
import { PREP_SOURCE } from "@/lib/agents/consult-prep/run";
import { LEAD, NOW, THURSDAY_CONSULT, draft, facts, jobsOn, proposal, row } from "./fixtures";

const task = (over: Partial<OpenTask> = {}): OpenTask => ({ id: "t-1", title: "Call Maya about the logo versions", type: "call", dueAt: "2026-11-12T15:00:00.000Z", assigneeId: null, createdAt: "2026-11-10T14:15:00.000Z", ...over });
const heldYesterday = { id: "m-1", provider: "zoom", title: "Strategy session", startedAt: "2026-11-16T19:00:00.000Z", durationSeconds: 2700, hasMaterial: true };

describe("the precedence table", () => {
  it("1. a failed approvals read is 'couldn't load', even with an overdue task and a booked consult", () => {
    const top = decideTopCard(facts({ approvals: unavailable(), tasks: { status: "ok", value: [task()] }, consult: { status: "ok", value: THURSDAY_CONSULT } }));
    expect(top).toEqual({ kind: "couldnt-load", what: "needs-you" });
  });

  it("2. a pending client-facing draft wins over an overdue task and a promise", () => {
    const top = decideTopCard(facts({ approvals: { status: "ok", value: [draft()] }, tasks: { status: "ok", value: [task()] }, consult: { status: "ok", value: THURSDAY_CONSULT } }));
    expect(top.kind).toBe("needs-yes");
  });

  it("2. a draft outranks a failed task read (the draft is a real fact)", () => {
    expect(decideTopCard(facts({ approvals: { status: "ok", value: [draft()] }, tasks: unavailable() })).kind).toBe("needs-yes");
  });

  it("2. the oldest draft is the card, and the rest are counted; internal briefings are never the card", () => {
    const old = draft({ id: "q-old", createdAt: "2026-11-15T10:00:00.000Z" });
    const young = draft({ id: "q-young", createdAt: "2026-11-17T10:00:00.000Z" });
    const brief = draft({ id: "q-brief", type: "BRIEFING", agent: "consult-prep", headline: "Consult heads-up", createdAt: "2026-11-01T10:00:00.000Z" });
    const top = decideTopCard(facts({ approvals: { status: "ok", value: [young, brief, old] } }));
    expect(top).toMatchObject({ kind: "needs-yes", item: { id: "q-old" }, others: 1 });
    expect(cardItems([brief])).toEqual([]);
    expect(decideTopCard(facts({ approvals: { status: "ok", value: [brief] } })).kind).not.toBe("needs-yes");
  });

  it("3. a failed task read with no draft is 'couldn't load', never a promise", () => {
    expect(decideTopCard(facts({ tasks: unavailable(), consult: { status: "ok", value: THURSDAY_CONSULT } }))).toEqual({ kind: "couldnt-load", what: "needs-you" });
  });

  it("4. an overdue or today step wins over a promise", () => {
    const overdue = decideTopCard(facts({ tasks: { status: "ok", value: [task()] }, consult: { status: "ok", value: THURSDAY_CONSULT } }));
    expect(overdue).toMatchObject({ kind: "yours", due: "overdue" });
    const today = decideTopCard(facts({ tasks: { status: "ok", value: [task({ dueAt: "2026-11-17T22:00:00.000Z" })] }, consult: { status: "ok", value: THURSDAY_CONSULT } }));
    expect(today).toMatchObject({ kind: "yours", due: "today" });
  });

  it("5. no approval queue: approvals-off, never a promise or a gap (a due-now step still wins)", () => {
    expect(decideTopCard(facts({ approvals: notSetUp("queue-off"), consult: { status: "ok", value: THURSDAY_CONSULT } }))).toEqual({ kind: "approvals-off" });
    expect(decideTopCard(facts({ approvals: notSetUp("queue-off") }))).toEqual({ kind: "approvals-off" });
    expect(decideTopCard(facts({ approvals: notSetUp("queue-off"), tasks: { status: "ok", value: [task()] } })).kind).toBe("yours");
  });

  it("6. a switched-on job: Lectual has it", () => {
    expect(decideTopCard(facts({ consult: { status: "ok", value: THURSDAY_CONSULT } })).kind).toBe("has-it");
  });

  it("6 before 7. a promise wins over a later step", () => {
    const later = task({ dueAt: "2026-11-25T15:00:00.000Z" });
    expect(decideTopCard(facts({ tasks: { status: "ok", value: [later] }, consult: { status: "ok", value: THURSDAY_CONSULT } })).kind).toBe("has-it");
  });

  it("7. a later or undated step wins over a gap", () => {
    const later = decideTopCard(facts({ tasks: { status: "ok", value: [task({ dueAt: "2026-11-25T15:00:00.000Z" })] } }));
    expect(later).toMatchObject({ kind: "yours", due: "later" });
    const undated = decideTopCard(facts({ tasks: { status: "ok", value: [task({ dueAt: null })] } }));
    expect(undated).toMatchObject({ kind: "yours", due: "none" });
  });

  it("8. a step no assistant prepares: not-prepared, by name", () => {
    expect(decideTopCard(facts())).toMatchObject({ kind: "not-prepared", gap: { id: "first-reply" } });
  });

  it("9. a job that is off: quiet, with why", () => {
    const top = decideTopCard(facts({ consult: { status: "ok", value: THURSDAY_CONSULT }, jobs: { status: "ok", value: jobsOn({ agentsOn: false }) } }));
    expect(top).toEqual({ kind: "quiet", off: { for: "consult-prep", why: "assistants-off" } });
  });

  it("10. nothing at all: quiet", () => {
    const top = decideTopCard(facts({ lead: { ...facts().lead, lastOutboundAt: "2026-11-16T10:00:00.000Z" } }));
    expect(top).toEqual({ kind: "quiet", off: null });
  });
});

describe("every failed read", () => {
  it("consult read failed: 'can't show what Lectual will do next', never a gap or quiet", () => {
    expect(decideTopCard(facts({ consult: unavailable() }))).toEqual({ kind: "couldnt-load", what: "next" });
  });
  it("meetings read failed", () => {
    expect(decideTopCard(facts({ meetings: unavailable() }))).toEqual({ kind: "couldnt-load", what: "next" });
  });
  it("proposal read failed", () => {
    expect(decideTopCard(facts({ proposal: unavailable() }))).toEqual({ kind: "couldnt-load", what: "next" });
  });
  it("paid state failed on an accepted proposal: never 'not paid'", () => {
    const p = proposal({ status: "accepted", acceptedAt: "2026-11-14T01:21:00.000Z", paid: { status: "unavailable" } });
    expect(decideTopCard(facts({ proposal: { status: "ok", value: p } }))).toEqual({ kind: "couldnt-load", what: "next" });
  });
  it("jobs read failed with a consult booked", () => {
    expect(decideTopCard(facts({ consult: { status: "ok", value: THURSDAY_CONSULT }, jobs: unavailable() }))).toEqual({ kind: "couldnt-load", what: "next" });
  });
  it("activity read failed with a consult booked (prep can't be told apart)", () => {
    expect(decideTopCard(facts({ consult: { status: "ok", value: THURSDAY_CONSULT }, activity: unavailable() }))).toEqual({ kind: "couldnt-load", what: "next" });
  });
  it("activity read failed with a recorded call", () => {
    expect(decideTopCard(facts({ meetings: { status: "ok", value: [heldYesterday] }, activity: unavailable() }))).toEqual({ kind: "couldnt-load", what: "next" });
  });
  it("autopilot state unknown with a consult booked: nothing is promised on a guess", () => {
    expect(decideTopCard(facts({ consult: { status: "ok", value: THURSDAY_CONSULT }, jobs: { status: "ok", value: jobsOn({ autopilot: "unknown" }) } }))).toEqual({ kind: "couldnt-load", what: "next" });
  });
  it("Mailboxes off is not a failure: no Outlook consult, the rest decides", () => {
    expect(decideTopCard(facts({ consult: notSetUp("mailbox-off") })).kind).toBe("not-prepared");
  });
});

describe("the not-prepared gaps", () => {
  it("accepted, not paid: the payment nudge (Sprint 5)", () => {
    const p = proposal({ status: "accepted", acceptedAt: "2026-11-14T01:21:00.000Z", paid: { status: "ok", paid: false, at: null } });
    expect(decideTopCard(facts({ proposal: { status: "ok", value: p } }))).toMatchObject({ kind: "not-prepared", gap: { id: "payment-nudge" } });
  });
  it("accepted and paid: no gap", () => {
    const p = proposal({ status: "accepted", paid: { status: "ok", paid: true, at: NOW } });
    expect(decideTopCard(facts({ proposal: { status: "ok", value: p } })).kind).toBe("quiet");
  });
  it("link live: the day-N follow-up (Sprint 7), counted on the firm's calendar", () => {
    expect(decideTopCard(facts({ proposal: { status: "ok", value: proposal() } }))).toMatchObject({ kind: "not-prepared", gap: { id: "follow-up", day: 2 } });
  });
  it("a consult recorded, no outcome, no proposal, the drafter off: reading the consult (Sprint 9 Part 2)", () => {
    const top = decideTopCard(facts({ meetings: { status: "ok", value: [heldYesterday] }, jobs: { status: "ok", value: jobsOn({ settings: {} }) } }));
    expect(top).toMatchObject({ kind: "not-prepared", gap: { id: "outcome-read" }, off: { for: "post-consult", why: "assistant-off" } });
  });
  it("an outcome a person logged closes the reading gap", () => {
    const logged = row({ id: "a-1", type: "call_logged", actor_type: "user", payload: { consult_outcome: "proposal_to_send" } });
    const top = decideTopCard(facts({ meetings: { status: "ok", value: [heldYesterday] }, activity: { status: "ok", value: [logged] }, jobs: { status: "ok", value: jobsOn({ settings: {} }) } }));
    expect(top.kind).toBe("quiet");
  });
  it("a new enquiry nobody has written to: the first reply", () => {
    expect(decideTopCard(facts())).toMatchObject({ kind: "not-prepared", gap: { id: "first-reply" } });
  });
  it("every gap names the sprint that fills it", () => {
    expect(GAP_FILLED_BY).toEqual({ "payment-nudge": "Sprint 5", "follow-up": "Sprint 7", "outcome-read": "Sprint 9 Part 2", "first-reply": "Sprint 9 Part 2 (no sprint builds it yet)" });
  });
  it("a gap never comes with a made-up draft: needs-yes only ever carries a real pending item", () => {
    for (const p of [proposal(), proposal({ status: "accepted", paid: { status: "ok", paid: false, at: null } })]) {
      const top = decideTopCard(facts({ proposal: { status: "ok", value: p } }));
      expect(top.kind).not.toBe("needs-yes");
    }
  });
});

describe("the six mockup states", () => {
  it("1 new enquiry: no assistant drafts the first reply today, so it is a named gap", () => {
    expect(decideTopCard(facts())).toMatchObject({ kind: "not-prepared", gap: { id: "first-reply" } });
  });
  it("2 consult booked, prep not done: Lectual has it (consult prep, Thursday's run)", () => {
    const top = decideTopCard(facts({ consult: { status: "ok", value: THURSDAY_CONSULT } }));
    expect(top).toMatchObject({ kind: "has-it", promise: { job: "consult-prep", window: { start: "2026-11-19T10:00:00.000Z" } } });
  });
  it("2b consult booked, prep done: Lectual has it (the proposal after the consult)", () => {
    const prepped = row({ id: "a-prep", type: "queue_drafted", payload: { source: PREP_SOURCE, kind: "heads_up", event_id: "evt-1", queueItemId: "q-9" } });
    const top = decideTopCard(facts({ consult: { status: "ok", value: THURSDAY_CONSULT }, activity: { status: "ok", value: [prepped] } }));
    expect(top).toMatchObject({ kind: "has-it", promise: { job: "post-consult", source: "after-consult", window: { start: "2026-11-20T10:00:00.000Z" } } });
  });
  it("3 consult happened: the drafter reads the recording at the next run", () => {
    const top = decideTopCard(facts({ meetings: { status: "ok", value: [heldYesterday] } }));
    expect(top).toMatchObject({ kind: "has-it", promise: { job: "post-consult", source: "recording", window: { start: "2026-11-18T10:00:00.000Z" } } });
  });
  it("3b consult happened and the drafter's email is pending: needs your yes", () => {
    const email = draft({ id: "q-pc", agent: "post-consult", headline: "Proposal for Maya Okafor" });
    expect(decideTopCard(facts({ approvals: { status: "ok", value: [email] }, meetings: { status: "ok", value: [heldYesterday] } }))).toMatchObject({ kind: "needs-yes", item: { id: "q-pc" } });
  });
  it("4 proposal out, day 2 of 7", () => {
    expect(decideTopCard(facts({ proposal: { status: "ok", value: proposal() } }))).toMatchObject({ kind: "not-prepared", gap: { id: "follow-up", day: 2 } });
  });
  it("5 accepted, not paid", () => {
    const p = proposal({ status: "accepted", signed: true, acceptedAt: "2026-11-14T01:21:00.000Z", paid: { status: "ok", paid: false, at: null } });
    expect(decideTopCard(facts({ proposal: { status: "ok", value: p } }))).toMatchObject({ kind: "not-prepared", gap: { id: "payment-nudge" } });
  });
  it("6 a step only a person can do, overdue", () => {
    expect(decideTopCard(facts({ tasks: { status: "ok", value: [task()] }, proposal: { status: "ok", value: proposal({ status: "draft", sentAt: null }) } }))).toMatchObject({
      kind: "yours",
      due: "overdue",
      task: { id: "t-1" },
    });
  });
});

describe("due state on the firm's calendar", () => {
  it("late evening in New York is still today there", () => {
    expect(dueState(task({ dueAt: "2026-11-18T03:00:00.000Z" }), new Date(NOW), "America/New_York")).toBe("today");
    expect(dueState(task({ dueAt: "2026-11-18T03:00:00.000Z" }), new Date(NOW), "UTC")).toBe("later");
  });
  it("merged lead: the card is about the keeper", () => {
    expect(facts().lead.id).toBe(LEAD);
  });
});
