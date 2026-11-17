import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/lib/lead-step/actions", () => ({ leadStepYesAction: vi.fn(), leadStepNotThisAction: vi.fn(), leadStepEditAction: vi.fn(), leadStepSendBackAction: vi.fn() }));
vi.mock("@/app/dashboard/review/actions", () => ({ completeNextStepAction: vi.fn(), setNextStepAction: vi.fn(), snoozeNextStepAction: vi.fn(), updateNextStepAction: vi.fn() }));
vi.mock("@/app/dashboard/leads/[id]/stage-keeper-actions", () => ({ acceptStageSuggestionAction: vi.fn(), dismissStageSuggestionAction: vi.fn(), undoAgentMoveAction: vi.fn() }));

import { TopCard } from "@/components/leads/TopCard";
import { TopCardFrame } from "@/components/leads/TopCardFrame";
import { NeedsYourYes } from "@/components/leads/NeedsYourYes";
import { WhatLectualDid } from "@/components/leads/WhatLectualDid";
import { FourFacts } from "@/components/leads/FourFacts";
import { holdSeconds, nextHold } from "@/components/leads/lead-step-hold";
import { buildLeadStepView, type NeedsYesView } from "@/lib/lead-step/view-model";
import { notSetUp, unavailable, type HandoffFact } from "@/lib/lead-step/facts";
import { ROLES, type Role } from "@/lib/auth/roles";
import { AGENT_ACTOR } from "@/lib/stage-keeper/moves";
import * as W from "@/lib/ui/words";
import { LEAD, ME, RAYN, THURSDAY_CONSULT, draft, facts, pending, proposal, row } from "../lead-step/fixtures";

const root = path.resolve(__dirname, "../..");
const src = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (f: string) => src(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const text = (html: string) => html.replaceAll("&#x27;", "'").replaceAll("&amp;", "&");
const MEMBERS = [{ userId: RAYN, name: "Rayn" }];

const top = (f = facts(), canWriteSteps = true, yoursDueDate: string | null = null) => {
  const v = buildLeadStepView(f);
  return text(renderToStaticMarkup(<TopCard leadId={LEAD} view={v.top} canWriteSteps={canWriteSteps} members={MEMBERS} yoursDueDate={yoursDueDate} />));
};
const hasButton = (html: string, label: string) => new RegExp(`<button[^>]*>${label}</button>`).test(html);

const LONG = "Hi Maya,\n\nOne.\n\nTwo.\n\nThree.\n\nFour.\n\nFive.\n\nSix is behind the fold.\n\nWarm regards,\nRebecca";

describe("the top card, one state at a time", () => {
  it("needs your yes: the prepared draft inline with Yes, Edit and Not this", () => {
    const html = top(facts({ approvals: pending(draft({ draftBody: LONG })) }));
    expect(html).toContain(W.LEAD_STEP_NEEDS_YES);
    expect(html).toContain("data-step=\"needs-yes\"");
    expect(html).toContain("maya@brightline.example");
    expect(html).toContain("Your Brightline Studio proposal");
    expect(html).toContain("Hi Maya,");
    expect(html).toContain(W.LEAD_PAGE_SHOW_WHOLE_DRAFT);
    for (const b of [W.LEAD_STEP_YES, W.LEAD_STEP_EDIT, W.LEAD_STEP_NOT_THIS]) expect(hasButton(html, b), b).toBe(true);
    expect(html).not.toContain(W.LEAD_STEP_HAS_IT);
  });

  it("a viewer sees the same card read-only: whose yes it waits on, and no button at all", () => {
    const html = top(facts({ approvals: pending(draft()), viewer: { ...facts().viewer, role: "viewer" } }));
    expect(html).toContain(W.LEAD_STEP_NEEDS_AN_APPROVER);
    expect(html).toContain(W.LEAD_STEP_WAITING_ON_APPROVER);
    expect(html).toContain("Hi Maya,");
    expect(html).toContain('data-read-only="true"');
    expect(html).not.toMatch(/<button/);
  });

  it("every role: Yes, Edit and Not this are drawn exactly when the engine says so", () => {
    for (const role of ROLES as readonly Role[]) {
      const f = facts({ approvals: pending(draft({ agent: "post-consult", headline: "Post-consult email" })), viewer: { ...facts().viewer, role } });
      const v = buildLeadStepView(f).top as NeedsYesView;
      const html = top(f);
      expect(hasButton(html, W.LEAD_STEP_YES), `${role} yes`).toBe(v.actions.yes);
      expect(hasButton(html, W.LEAD_STEP_EDIT), `${role} edit`).toBe(v.actions.edit);
      expect(hasButton(html, W.LEAD_STEP_NOT_THIS), `${role} not this`).toBe(v.actions.notThis);
    }
  });

  it("a law clerk sees no Yes on a post-consult email", () => {
    const html = top(facts({ approvals: pending(draft({ agent: "post-consult", headline: "Post-consult email" })), viewer: { ...facts().viewer, role: "law_clerk" } }));
    expect(hasButton(html, W.LEAD_STEP_YES)).toBe(false);
    expect(hasButton(html, W.LEAD_STEP_NOT_THIS)).toBe(false);
  });

  it("a draft that needs a closer look: no Yes, the reason and a link to Approvals", () => {
    const html = top(facts({ approvals: pending(draft({ closerLook: { reasons: ["stale"], linkNotLive: false } })) }));
    expect(hasButton(html, W.LEAD_STEP_YES)).toBe(false);
    expect(html).toContain(W.LEAD_STEP_CLOSER_LOOK);
    expect(html).toContain('href="/dashboard/queue/q-1/"');
    expect(hasButton(html, W.LEAD_STEP_NOT_THIS)).toBe(true);
  });

  it("a linked proposal shows its rows and link", () => {
    const linked = draft({ agent: "post-consult", linked: { status: "ok", id: "p-1", version: 1, proposalStatus: "sent", clientName: "Maya", legalCents: 547000, govCents: 140000, errorCount: 0, gateRefusal: null }, closerLook: { reasons: [], linkNotLive: false } });
    const html = top(facts({ approvals: pending(linked) }));
    expect(html).toContain(W.LEAD_STEP_ROW_LEGAL);
    expect(html).toContain("$5,470.00");
    expect(html).toContain('href="/dashboard/proposals/p-1/"');
  });

  it("handed to you: says by whom and offers Send back; handed away: no Yes, the sentence", () => {
    const toMe: HandoffFact = { status: "ok", holder: { userId: ME, by: RAYN, note: "Please check the date", at: "2026-11-17T14:00:00Z" } };
    const routing = { status: "ok" as const, routing: {}, members: [{ userId: RAYN, role: "law_clerk" as Role, displayName: "Rayn" }] };
    const html = top(facts({ approvals: pending(draft({ handoff: toMe })), routing }));
    expect(html).toContain(W.leadStepHandedToYou("Rayn"));
    expect(html).toContain("Please check the date");
    expect(hasButton(html, W.LEAD_STEP_SEND_BACK)).toBe(true);
    const away: HandoffFact = { status: "ok", holder: { userId: RAYN, by: ME, note: null, at: "2026-11-17T14:00:00Z" } };
    const gone = top(facts({ approvals: pending(draft({ handoff: away })), routing }));
    expect(gone).toContain(W.leadStepHandedTo("Rayn"));
    expect(gone).toContain(W.LEAD_STEP_HANDED_AWAY);
    expect(hasButton(gone, W.LEAD_STEP_YES)).toBe(false);
    expect(hasButton(gone, W.LEAD_STEP_SEND_BACK)).toBe(false);
  });

  it("more than one waiting: says so and links to Approvals", () => {
    const html = top(facts({ approvals: pending(draft(), draft({ id: "q-2" })) }));
    expect(html).toContain(W.leadStepOthers(1));
    expect(html).toContain(W.LEAD_PAGE_APPROVALS_LINK);
  });

  it("Lectual has it: what it waits for and what it does next, no buttons", () => {
    const html = top(facts({ consult: { status: "ok", value: THURSDAY_CONSULT } }));
    expect(html).toContain('data-step="has-it"');
    expect(html).toContain(W.LEAD_STEP_HAS_IT);
    expect(html).toContain("Waiting for the consult on Thu, Nov 19, 2:00 PM");
    expect(html).toContain("Lectual prepares a consult heads-up");
    expect(html).not.toMatch(/<button/);
  });

  it("yours to do: Mark done, Snooze and Change for a role that writes; none for one that doesn't", () => {
    const tasks = { status: "ok" as const, value: [{ id: "55555555-5555-4555-8555-555555555555", title: "Call Maya", type: "custom", dueAt: "2026-11-16T12:00:00.000Z", assigneeId: null, createdAt: "2026-11-10T12:00:00.000Z" }] };
    const f = facts({ tasks });
    const html = top(f, true, "2026-11-16");
    expect(html).toContain('data-step="yours"');
    expect(html).toContain(W.LEAD_STEP_YOURS);
    expect(html).toContain(W.LEAD_STEP_OVERDUE);
    expect(html).toContain("Call Maya");
    for (const b of [W.LEAD_PAGE_MARK_DONE]) expect(hasButton(html, b), b).toBe(true);
    expect(html).toContain(`>${W.LEAD_PAGE_SNOOZE}</summary>`);
    expect(html).toContain(`>${W.LEAD_PAGE_CHANGE}</summary>`);
    expect(html).toContain('name="when" value="tomorrow"');
    expect(html).toContain('value="2026-11-16"');
    const ro = top(f, false);
    expect(ro).toContain("Call Maya");
    expect(ro).not.toMatch(/<button|<summary/);
  });

  it("not prepared names the gap; approvals off and quiet say so; each offers Set a next step only to a writer", () => {
    const np = top(facts({ proposal: { status: "ok", value: proposal() } }));
    expect(np).toContain(W.LEAD_STEP_NOT_PREPARED);
    expect(np).toContain(W.leadStepFollowUpDay(2));
    expect(np).toContain(`>${W.LEAD_STEP_SET_NEXT_STEP}</summary>`);
    expect(np).toContain('name="kind" value="lead"');
    const off = top(facts({ approvals: notSetUp("queue-off") }));
    expect(off).toContain(W.LEAD_STEP_APPROVALS_OFF);
    expect(off).not.toContain(W.LEAD_STEP_HAS_IT);
    const none = top(facts({ proposal: { status: "ok", value: proposal() } }), false);
    expect(none).not.toContain("<summary");
  });

  it("couldn't load: the fixed sentence, never 'Lectual has it' and never 'nothing needs you'", () => {
    for (const f of [facts({ approvals: unavailable() }), facts({ approvals: unavailable(), consult: { status: "ok", value: THURSDAY_CONSULT } })]) {
      const html = top(f);
      expect(html).toContain(W.LEAD_STEP_CANT_SHOW_NEEDS);
      expect(html).not.toContain(W.LEAD_STEP_HAS_IT);
      expect(html).not.toContain(W.LEAD_STEP_QUIET_NOTE);
    }
  });
});

describe("Yes: the hold, Undo, and what is said afterwards", () => {
  const needs = buildLeadStepView(facts({ approvals: pending(draft()) })).top as NeedsYesView;

  it("the hold is a pure countdown: it fires on the last tick only, and Undo never fires", () => {
    expect(holdSeconds(needs.holdMs)).toBe(5);
    let s = nextHold({ holding: null }, "start", 5).state;
    expect(s.holding).toBe(5);
    const fired: boolean[] = [];
    for (let i = 0; i < 5; i++) {
      const step = nextHold(s, "tick", 5);
      s = step.state;
      fired.push(step.fire);
    }
    expect(fired).toEqual([false, false, false, false, true]);
    expect(s.holding).toBeNull();
    // Undo in the window: nothing fires, and no later tick can.
    let u = nextHold({ holding: null }, "start", 5).state;
    u = nextHold(u, "tick", 5).state;
    const undone = nextHold(u, "undo", 5);
    expect(undone).toEqual({ state: { holding: null }, fire: false });
    expect(nextHold(undone.state, "tick", 5).fire).toBe(false);
    // A second start while holding changes nothing.
    expect(nextHold({ holding: 3 }, "start", 5)).toEqual({ state: { holding: 3 }, fire: false });
  });

  it("while holding, the card shows the deck's hold toast with Undo and the buttons are off; the sentence says nothing happened yet", () => {
    const html = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={needs} initial={{ holding: 3 }} />));
    expect(html).toContain(W.deckHolding(3));
    expect(html).toContain(W.DECK_UNDO);
    expect(html).toContain(W.DECK_HOLD_NOTE);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Yes<\/button>/);
  });

  it("the Yes action is posted only from the end of the hold, never from the click or from Undo", () => {
    const c = code("src/components/leads/NeedsYourYes.tsx");
    expect(c.match(/leadStepYesAction\(/g)).toHaveLength(1);
    const start = c.slice(c.indexOf("const startHold"), c.indexOf("const undo"));
    expect(start).toContain("if (!step.fire) return;");
    expect(start.indexOf("leadStepYesAction")).toBeGreaterThan(start.indexOf("if (!step.fire) return;"));
    const undoBody = c.slice(c.indexOf("const undo"), c.indexOf("const done"));
    expect(undoBody).not.toMatch(/run\(|leadStep/);
    expect(c).toMatch(/onClick=\{startHold\}/);
  });

  it("after Yes the frame says exactly the sentence the action returned, and nothing is assumed", () => {
    const sentence = W.leadStepDraftInMailbox("Rayn", "Outlook");
    const html = text(renderToStaticMarkup(<TopCardFrame initial={{ tone: "ok", message: sentence }}>x</TopCardFrame>));
    expect(html).toContain("Approved. The draft is in Rayn's Outlook. Nothing is sent until Rayn presses Send.");
    const c = code("src/components/leads/NeedsYourYes.tsx");
    expect(c).not.toMatch(/Outlook/);
    expect(c).toMatch(/say\(\{ tone: "ok", message: r\.message/);
  });

  it("Not this needs a reason: the form has a required field and the fixed sentence", () => {
    const html = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={needs} initial={{ mode: "rejecting" }} />));
    expect(html).toContain(W.LEAD_STEP_REASON_LABEL);
    expect(html).toMatch(/<input[^>]*maxLength="200"[^>]*required=""|<input[^>]*required=""[^>]*maxLength="200"/);
    expect(html).toContain(W.LEAD_STEP_DROP);
    const empty = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={needs} initial={{ mode: "rejecting", outcome: { ok: false, error: W.LEAD_STEP_REASON_NEEDED } }} />));
    expect(empty).toContain(W.LEAD_STEP_REASON_NEEDED);
  });

  it("Edit opens the inline editor on the draft and Save edit calls the lead step edit action; Yes waits while editing", () => {
    const html = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={needs} initial={{ mode: "editing", body: "Edited text" }} />));
    expect(html).toContain('data-draft="edit"');
    expect(html).toContain("Edited text");
    expect(html).toContain(W.LEAD_PAGE_EDIT_SAVE);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Yes<\/button>/);
    expect(code("src/components/leads/NeedsYourYes.tsx")).toMatch(/leadStepEditAction\(leadId, view\.itemId, body\)/);
  });

  it("a refusal shows the action's fixed sentence in an alert, and the card stays", () => {
    const html = text(renderToStaticMarkup(<NeedsYourYes leadId={LEAD} view={needs} initial={{ outcome: { ok: false, error: W.LEAD_STEP_CLOSER_LOOK } }} />));
    expect(html).toContain('role="alert"');
    expect(html).toContain(W.LEAD_STEP_CLOSER_LOOK);
    expect(hasButton(html, W.LEAD_STEP_YES)).toBe(true);
  });

  it("no raw error text anywhere in the new components", () => {
    for (const f of ["NeedsYourYes", "StepControls", "TopCard", "TopCardFrame", "WhatLectualDid", "FourFacts"]) {
      const c = code(`src/components/leads/${f}.tsx`);
      expect(c, f).not.toMatch(/\b(?:err|error|e|ex)\.message\b|String\(e|dangerouslySetInnerHTML|console\./);
    }
    const c = code("src/components/leads/NeedsYourYes.tsx");
    expect(c).toContain("LEAD_PAGE_ACTION_FAILED");
  });
});

describe("What Lectual did, and the four facts", () => {
  const move = (id: string, at: string) => row({ id, type: "stage_changed", created_at: at, payload: { actor: AGENT_ACTOR, from_stage_id: "s-new", to_stage_id: "s-booked", from_stage: "Potential New Client", to_stage: "Consult Scheduled" } });
  const did = (rows: ReturnType<typeof row>[], over = {}) => buildLeadStepView(facts({ lead: { ...facts().lead, stageId: "s-booked" }, activity: { status: "ok", value: { rows, truncated: false } }, ...over })).did;

  it("Undo only on a row the engine offered it for; the rest of the list is behind Show all", () => {
    const rows = [
      move("m1", "2026-11-16T15:00:00Z"),
      row({ id: "e1", type: "email_received", actor_type: "system", created_at: "2026-11-15T15:00:00Z" }),
      row({ id: "e2", type: "email_received", actor_type: "system", created_at: "2026-11-14T15:00:00Z" }),
      row({ id: "e3", type: "email_received", actor_type: "system", created_at: "2026-11-13T15:00:00Z" }),
    ];
    const html = text(renderToStaticMarkup(<WhatLectualDid leadId={LEAD} did={did(rows)} />));
    expect(html).toContain(W.LEAD_STEP_DID_TITLE);
    expect(html.match(/>Undo</g)).toHaveLength(1);
    expect(html).toContain(W.LEAD_PAGE_DID_ALL(4));
    const noUndo = text(renderToStaticMarkup(<WhatLectualDid leadId={LEAD} did={did(rows, { viewer: { ...facts().viewer, canMoveStage: false } })} />));
    expect(noUndo).not.toContain(">Undo<");
  });

  it("a list cut at the read's cap says so; a failed read says couldn't load and never 'Nothing yet'", () => {
    const cut = buildLeadStepView(facts({ activity: { status: "ok", value: { rows: [row({ id: "e1", type: "email_received", actor_type: "system" })], truncated: true } } })).did;
    expect(text(renderToStaticMarkup(<WhatLectualDid leadId={LEAD} did={cut} />))).toContain(W.LEAD_STEP_DID_CUT);
    const failed = text(renderToStaticMarkup(<WhatLectualDid leadId={LEAD} did={buildLeadStepView(facts({ activity: unavailable() })).did} />));
    expect(failed).toContain(W.LEAD_STEP_DID_UNAVAILABLE);
    expect(failed).not.toContain(W.LEAD_STEP_DID_EMPTY);
    expect(text(renderToStaticMarkup(<WhatLectualDid leadId={LEAD} did={did([])} />))).toContain(W.LEAD_STEP_DID_EMPTY);
  });

  it("the four facts: Last contact, Consult, Proposal and Waiting on; Proposal is absent without the feature; a failed read says so", () => {
    const four = text(renderToStaticMarkup(<FourFacts facts={buildLeadStepView(facts({ proposal: { status: "ok", value: proposal() } })).facts} />));
    for (const l of [W.LEAD_STEP_FACT_CONTACT, W.LEAD_STEP_FACT_CONSULT, W.LEAD_STEP_FACT_PROPOSAL, W.LEAD_STEP_FACT_WAITING]) expect(four).toContain(l);
    const three = text(renderToStaticMarkup(<FourFacts facts={buildLeadStepView(facts({ proposal: notSetUp("proposals-off") })).facts} />));
    expect(three).not.toContain(W.LEAD_STEP_FACT_PROPOSAL);
    const failed = text(renderToStaticMarkup(<FourFacts facts={buildLeadStepView(facts({ consult: unavailable() })).facts} />));
    expect(failed).toContain(W.LEAD_STEP_COULDNT_LOAD);
    expect(failed).not.toContain(W.LEAD_STEP_NOT_BOOKED);
  });
});

describe("the page keeps today's page", () => {
  const page = src("src/app/dashboard/leads/[id]/page.tsx");
  const body = page.slice(page.indexOf("return ("));
  it("the timeline and the composer are the same components with the same props", () => {
    expect(body).toContain("<ComposerTabs");
    expect(body).toContain("<NoteComposer leadId={lead.id} />");
    expect(body).toContain("<VoiceNoteRecorder target={{ kind: \"lead\", id: lead.id }} action={addVoiceNoteAction} />");
    expect(body).toContain("<Timeline rows={rows} mediaUrls={voiceUrls} timeZone={tz} undo={{ leadId: lead.id, canMove, currentStageId: lead.current_stage_id }} />");
    // Under the top card: the top block comes before the composer, which comes before the timeline.
    expect(body.indexOf("<TopCard")).toBeLessThan(body.indexOf("<ComposerTabs"));
    expect(body.indexOf("<ComposerTabs")).toBeLessThan(body.indexOf("<Timeline"));
  });
  it("the Documents & files card keeps upload (and delete) for the roles that have them", () => {
    expect(body).toContain("canUpload={FILE_UPLOAD_ROLES.includes(session.role)}");
    expect(body).toContain("canDelete={FILE_DELETE_ROLES.includes(session.role)}");
    expect(body).toContain("<DocumentsCard");
  });
  it("what the top card replaced is gone, and what it does not cover is kept", () => {
    expect(body).not.toContain("<WaitingOnRebecca");
    expect(body).not.toContain("loadPendingApprovalsByLead");
    for (const kept of ["<ConsultBookedView", "<ProposalCard", "<StageSuggestionCard", "<ConsultOutcomeForm", "<LeadStatusRow", "<SequencesCard", "<TemperatureCard", "<AnswersCard"]) expect(page, kept).toContain(kept);
  });
  it("a lead the engine couldn't read is the couldn't-load card, never a calm one", () => {
    expect(page).toMatch(/step \? step\.top : \{ kind: "couldnt-load", text: LEAD_STEP_CANT_SHOW_NEEDS \}/);
  });
  it("the page reads the engine and draws its view, and decides nothing itself", () => {
    expect(page).toContain("loadLeadStepFacts(lead.id)");
    expect(page).toContain("buildLeadStepView(stepLoad.facts)");
    expect(page).not.toMatch(/decideTopCard|viewerMayDecide|canApproveItem/);
  });
});
