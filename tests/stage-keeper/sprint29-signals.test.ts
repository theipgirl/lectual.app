import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueueItem } from "../../src/lib/queue/api";
import { runStageKeeper } from "../../src/lib/agents/stage-keeper/run";
import { DEFAULT_STAGE_NAMES, parseStageMapping, stageForSignal } from "../../src/lib/agents/stage-keeper/mapping";
import { targetStageFromSignals } from "../../src/lib/agents/stage-keeper/target";
import { signalIdFor, signalKeyFor, evidenceOf, type KeeperSignal } from "../../src/lib/stage-keeper/signals";
import type { StageOpt } from "../../src/lib/reconcile/types";
import { assertOrgFenced, NOW } from "../agents/helpers";
import { agentRows, keeperWorld, lead, mail, messageIdOf, personMove, suggestionRows, type Row, type WorldInit } from "./db";
import { L, ORG, SENTINEL, daysAgo } from "./fixtures";

/** Sprint 29 A: consult-held (meetings), post-consult-sent from a live proposal and an approved queue email, firm-sent mail. */

const ST = {
  followUp: "5c000000-0000-4000-8000-000000000001",
  pnc: "5c000000-0000-4000-8000-000000000002",
  scheduled: "5c000000-0000-4000-8000-000000000003",
  held: "5c000000-0000-4000-8000-000000000004",
  post: "5c000000-0000-4000-8000-000000000005",
  loe: "5c000000-0000-4000-8000-000000000006",
  signed: "5c000000-0000-4000-8000-000000000007",
  nurture: "5c000000-0000-4000-8000-000000000008",
};

/** RPB-shaped: Follow-Up is where nearly everybody sits, and there is no "Consult Held" stage. */
const RPB: StageOpt[] = [
  { id: ST.followUp, name: "Follow-Up", category: "open", orderIndex: 1 },
  { id: ST.pnc, name: "Potential New Client", category: "open", orderIndex: 2 },
  { id: ST.scheduled, name: "Consultation Scheduled", category: "open", orderIndex: 3 },
  { id: ST.post, name: "Post Consultation Email Sent", category: "open", orderIndex: 5 },
  { id: ST.loe, name: "LOE & Invoice Sent", category: "open", orderIndex: 7 },
  { id: ST.signed, name: "Signed LOE / Deposit Received", category: "won", orderIndex: 8 },
  { id: ST.nurture, name: "Nurture", category: "nurture", orderIndex: 9 },
];
const WITH_HELD: StageOpt[] = [...RPB, { id: ST.held, name: "Consult Held", category: "open", orderIndex: 4 }];
const rows = (stages: StageOpt[]): Row[] => stages.map((s) => ({ id: s.id, org_id: ORG, name: s.name, category: s.category, order_index: s.orderIndex }));

let seq = 0;
const meeting = (leadId: string | null, over: Row = {}): Row => ({
  id: `meeting-${++seq}`,
  org_id: ORG,
  lead_id: leadId,
  suggested_lead_id: null,
  provider: "zoom",
  title: "Strategy session with Melvin",
  started_at: daysAgo(4),
  transcript: null,
  summary: SENTINEL,
  attendees: [{ email: `${SENTINEL}@guest.test` }],
  share_url: `https://zoom.test/${SENTINEL}`,
  ...over,
});
const proposal = (leadId: string | null, over: Row = {}): Row => ({
  id: `proposal-${++seq}`,
  org_id: ORG,
  lead_id: leadId,
  family_id: `family-${seq}`,
  version: 1,
  status: "sent",
  sent_at: daysAgo(3),
  accepted_at: null,
  created_at: daysAgo(3),
  client_email: `${SENTINEL}@client.test`,
  content: { body: SENTINEL },
  ...over,
});
const queueItem = (over: Partial<QueueItem> = {}): QueueItem => ({
  id: "0c0c0c0c-0000-4000-8000-000000000001",
  org_id: "firm-queue-key",
  matter_id: null,
  agent: "post-consult",
  type: "CLIENT_EMAIL",
  headline: "Post-consult follow-up - Melvin",
  summary: SENTINEL,
  draft_body: SENTINEL,
  final_body: SENTINEL,
  status: "approved",
  created_at: daysAgo(3),
  client_name: "Melvin",
  recipient: `${SENTINEL}@client.test`,
  subject: SENTINEL,
  proposed_send_at: null,
  attachments: null,
  resolved_by: null,
  resolved_at: daysAgo(2),
  resolution_note: null,
  ...over,
});
/** The queue_drafted row the drafter writes: rule 1 of the queue's linking rules. */
const drafted = (leadId: string, itemId: string): Row => ({
  id: `qd-${itemId}`,
  org_id: ORG,
  lead_id: leadId,
  type: "queue_drafted",
  actor_type: "ai",
  created_at: daysAgo(3),
  payload: { queueItemId: itemId, kind: "post-consult" },
});
const conn = (email: string, status = "active"): Row => ({ id: `conn-${email}`, org_id: ORG, email, status });

function world(init: { stages?: StageOpt[]; leads?: Row[]; activity?: Row[]; meetings?: Row[]; proposals?: Row[]; connections?: Row[]; refuse?: WorldInit["refuse"] }) {
  return keeperWorld({
    stages: rows(init.stages ?? RPB),
    leads: init.leads ?? [],
    activity: init.activity ?? [],
    refuse: init.refuse,
    extra: { crm_meeting: init.meetings ?? [], client_proposal: init.proposals ?? [], mailbox_connection: init.connections ?? [] },
  });
}
const leadOf = (w: ReturnType<typeof keeperWorld>, id: string = L.amara) => w.db.tables.crm_lead.find((l) => l.id === id)!;

let spies: ReturnType<typeof vi.spyOn>[];
beforeEach(() => {
  spies = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
});
afterEach(() => vi.restoreAllMocks());
const consoleOutput = () => spies.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(" ")).join("\n");

describe("consult-held from a linked meeting", () => {
  it("a past meeting linked by lead_id places the lead and keys the signal <lead>:meeting:<id>", async () => {
    const m = meeting(L.amara);
    const w = world({ leads: [lead(L.amara, ST.followUp)], meetings: [m] });
    const { ctx, createDraft } = w.ctx("act");
    await runStageKeeper(ctx);
    // No "Consult Held" stage: a held consult supports the stage a booked one does.
    expect(leadOf(w).current_stage_id).toBe(ST.scheduled);
    const [move] = agentRows(w.rows("crm_activity"));
    expect(move.payload).toMatchObject({
      signal: "consult-held",
      signal_key: `${L.amara}:meeting:${m.id}`,
      evidence: { kind: "meeting", provider: "zoom", title: "Strategy session with Melvin", starts_at: m.started_at },
    });
    expect(leadOf(w).stage_entered_at).toBe(m.started_at);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("uses the Consult Held stage when the firm has one", async () => {
    const w = world({ stages: WITH_HELD, leads: [lead(L.amara, ST.followUp)], meetings: [meeting(L.amara, { provider: "fathom" })] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.held);
    expect(agentRows(w.rows("crm_activity"))[0].payload.evidence).toMatchObject({ kind: "meeting", provider: "fathom" });
  });

  it("a meeting with only suggested_lead_id yields no signal", async () => {
    const w = world({ leads: [lead(L.amara, ST.followUp)], meetings: [meeting(null, { suggested_lead_id: L.amara })] });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
    expect(agentRows(w.rows("crm_activity"))).toEqual([]);
    expect(result.summary).toBe("No matched mail or booked consults to place.");
  });

  it("a future meeting yields none; a meeting that already has a transcript counts", async () => {
    const future = world({ leads: [lead(L.amara, ST.followUp)], meetings: [meeting(L.amara, { started_at: new Date(NOW + 3 * 86_400_000).toISOString() })] });
    await runStageKeeper(future.ctx("act").ctx);
    expect(leadOf(future).current_stage_id).toBe(ST.followUp);

    const done = world({ leads: [lead(L.amara, ST.followUp)], meetings: [meeting(L.amara, { transcript: [{ speaker: "A", text: SENTINEL }] })] });
    await runStageKeeper(done.ctx("act").ctx);
    expect(leadOf(done).current_stage_id).toBe(ST.scheduled);
  });

  it("a meeting older than the signal window, or with no start, yields none", async () => {
    const w = world({ leads: [lead(L.amara, ST.followUp)], meetings: [meeting(L.amara, { started_at: daysAgo(60) }), meeting(L.amara, { started_at: null })] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
  });

  it("never selects the transcript, summary, attendees or share link", async () => {
    const w = world({ leads: [lead(L.amara, ST.followUp)], meetings: [meeting(L.amara)] });
    const { ctx, log } = w.ctx("act");
    await runStageKeeper(ctx);
    for (const q of log.filter((x) => x.table === "crm_meeting")) expect(q.columns ?? "").not.toMatch(/transcript|summary|attendees|share_url|\*/);
    assertOrgFenced(log);
  });

  it("an unreadable meetings table is said out loud, not read as no meetings", async () => {
    const w = world({
      leads: [lead(L.amara, ST.pnc)],
      activity: [mail(L.amara, "post-consult")],
      refuse: (q) => (q.table === "crm_meeting" ? { message: "boom" } : undefined),
    });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(result.summary).toContain("Linked meetings couldn't be read this run.");
    expect(leadOf(w).current_stage_id).toBe(ST.post); // the rest of the input still works
  });
});

describe("consult-held mapping", () => {
  const stage = (name: string, orderIndex: number, id = `s-${name}`): StageOpt => ({ id, name, category: "open", orderIndex });

  it("resolves Consult Held, then Consultation Held, then Consult Completed, in that order", () => {
    expect(DEFAULT_STAGE_NAMES["consult-held"]).toEqual(["Consult Held", "Consultation Held", "Consult Completed"]);
    const all = [stage("Consult Completed", 4), stage("Consultation Held", 3), stage("Consult Held", 2), stage("Consultation Scheduled", 1)];
    expect(stageForSignal("consult-held", all, {})?.name).toBe("Consult Held");
    expect(stageForSignal("consult-held", all.filter((s) => s.name !== "Consult Held"), {})?.name).toBe("Consultation Held");
    expect(stageForSignal("consult-held", all.filter((s) => s.name === "Consult Completed" || s.name === "Consultation Scheduled"), {})?.name).toBe("Consult Completed");
  });

  it("falls back to the consult-scheduled stage when the firm has none of them", () => {
    expect(stageForSignal("consult-held", [stage("Consultation Scheduled", 1), stage("Proposal Sent", 2)], {})?.name).toBe("Consultation Scheduled");
    expect(stageForSignal("consult-held", [stage("Proposal Sent", 2)], {})).toBeNull();
  });

  it("a firm brain entry wins, and an entry naming a stage the firm lacks gives nothing (no fallback)", () => {
    const stages = [stage("Consultation Scheduled", 1), stage("Strategy Done", 2)];
    expect(stageForSignal("consult-held", stages, parseStageMapping([{ key: "consult-held", data: { stage: "Strategy Done" } }]))?.name).toBe("Strategy Done");
    expect(stageForSignal("consult-held", stages, parseStageMapping([{ key: "consult-held", data: { stage: "Nowhere" } }]))).toBeNull();
  });

  it("the ON HOLD board names are not added as defaults", () => {
    const all = JSON.stringify(DEFAULT_STAGE_NAMES);
    expect(all).not.toMatch(/Proposal in Progress/i);
    expect(JSON.stringify(DEFAULT_STAGE_NAMES["consult-scheduled"])).toBe(
      JSON.stringify(["Consultation Scheduled", "Consult Scheduled", "Consult Booked", "Strategy Session Scheduled", "Discovery Call Scheduled"]),
    );
  });
});

describe("post-consult-sent from a live proposal", () => {
  it.each(["sent", "accepted"])("a %s proposal places the lead, keyed <lead>:proposal:<family_id>", async (status) => {
    const p = proposal(L.amara, { status, accepted_at: status === "accepted" ? daysAgo(1) : null, version: 2 });
    const w = world({ leads: [lead(L.amara, ST.followUp)], proposals: [p] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.post);
    const [move] = agentRows(w.rows("crm_activity"));
    expect(move.payload).toMatchObject({
      signal: "post-consult-sent",
      signal_key: `${L.amara}:proposal:${p.family_id}`,
      evidence: { kind: "proposal", version: 2, status, at: status === "accepted" ? daysAgo(1) : daysAgo(3) },
    });
  });

  it.each(["draft", "approved", "superseded", "withdrawn"])("a %s proposal yields none", async (status) => {
    const w = world({ leads: [lead(L.amara, ST.followUp)], proposals: [proposal(L.amara, { status })] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
  });

  it("two live versions of one family are one signal; a proposal with no lead places nobody", async () => {
    const a = proposal(L.amara, { family_id: "fam-x", version: 1, sent_at: daysAgo(6) });
    const b = proposal(L.amara, { family_id: "fam-x", version: 2, sent_at: daysAgo(2) });
    const w = world({ leads: [lead(L.amara, ST.followUp)], proposals: [a, b, proposal(null)] });
    const { ctx } = w.ctx("act");
    await runStageKeeper(ctx);
    const moves = agentRows(w.rows("crm_activity"));
    expect(moves).toHaveLength(1);
    expect(moves[0].payload.signal_key).toBe(`${L.amara}:proposal:fam-x`);
    expect(moves[0].payload.evidence).toMatchObject({ version: 2 });
  });

  it("selects no content, address or pay link", async () => {
    const w = world({ leads: [lead(L.amara, ST.followUp)], proposals: [proposal(L.amara)] });
    const { ctx, log } = w.ctx("act");
    await runStageKeeper(ctx);
    for (const q of log.filter((x) => x.table === "client_proposal")) expect(q.columns ?? "").not.toMatch(/content|client_email|pay_url|public_token|\*/);
  });

  it("an unreadable proposals table is said out loud", async () => {
    const w = world({ leads: [lead(L.amara, ST.pnc)], activity: [mail(L.amara, "post-consult")], refuse: (q) => (q.table === "client_proposal" ? { message: "boom" } : undefined) });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(result.summary).toContain("Proposals couldn't be read this run.");
  });
});

describe("post-consult-sent from an approved queue email", () => {
  const withQueue = (w: ReturnType<typeof world>, listApproved: () => Promise<QueueItem[]>) => {
    const made = w.ctx("act");
    made.ctx.listApproved = listApproved;
    return made;
  };

  it("an approved post-consult CLIENT_EMAIL linked to the lead places it, keyed <lead>:queue:<id>", async () => {
    const item = queueItem();
    const w = world({ leads: [lead(L.amara, ST.followUp)], activity: [drafted(L.amara, item.id)] });
    const { ctx, createDraft } = withQueue(w, async () => [item]);
    await runStageKeeper(ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.post);
    const [move] = agentRows(w.rows("crm_activity"));
    expect(move.payload).toMatchObject({
      signal: "post-consult-sent",
      signal_key: `${L.amara}:queue:${item.id}`,
      evidence: { kind: "queue", type: "CLIENT_EMAIL", at: item.resolved_at },
    });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("pending, rejected, other types and other agents yield none", async () => {
    const items = [
      queueItem({ id: "0c0c0c0c-0000-4000-8000-000000000011", status: "pending" }),
      queueItem({ id: "0c0c0c0c-0000-4000-8000-000000000012", status: "rejected" }),
      queueItem({ id: "0c0c0c0c-0000-4000-8000-000000000013", type: "INTERNAL_SUMMARY" }),
      queueItem({ id: "0c0c0c0c-0000-4000-8000-000000000014", agent: "morning-brief", headline: "Follow up with Melvin" }),
    ];
    const w = world({ leads: [lead(L.amara, ST.followUp)], activity: items.map((i) => drafted(L.amara, i.id)) });
    await runStageKeeper(withQueue(w, async () => items).ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
  });

  it("an item that names two leads places nobody", async () => {
    const item = queueItem();
    const w = world({ leads: [lead(L.amara, ST.followUp), lead(L.kwame, ST.followUp)], activity: [drafted(L.amara, item.id), drafted(L.kwame, item.id)] });
    await runStageKeeper(withQueue(w, async () => [item]).ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
    expect(leadOf(w, L.kwame).current_stage_id).toBe(ST.followUp);
  });

  it("an unreadable queue gives no signal and the summary says so, never 'none approved'", async () => {
    const w = world({ leads: [lead(L.amara, ST.pnc)], activity: [mail(L.amara, "questionnaire")] });
    const result = await runStageKeeper(withQueue(w, async () => { throw new Error(`Queue API 502: ${SENTINEL}`); }).ctx);
    expect(result.summary).toContain("Approved post-consult emails couldn't be read this run.");
    expect(result.summary).not.toContain(SENTINEL);
    expect(leadOf(w).current_stage_id).not.toBe(ST.post);
  });

  it("a firm with no queue wired adds no note", async () => {
    const w = world({ leads: [lead(L.amara, ST.pnc)], activity: [mail(L.amara, "post-consult")] });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(result.summary).toBe("1 lead(s) read: 1 moved, 0 suggestion(s) written.");
  });
});

describe("the Melvin fixture", () => {
  it("Follow-Up + a held Zoom consult + a sent proposal + an approved email ends at Post Consultation Email Sent in ONE run; a second run is a no-op", async () => {
    const m = meeting(L.amara);
    const p = proposal(L.amara);
    const item = queueItem();
    const w = world({ leads: [lead(L.amara, ST.followUp)], meetings: [m], proposals: [p], activity: [drafted(L.amara, item.id)] });
    const first = w.ctx("act");
    first.ctx.listApproved = async () => [item];
    const result = await runStageKeeper(first.ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.post);
    expect(result.summary).toBe("1 lead(s) read: 1 moved, 0 suggestion(s) written.");
    const moves = agentRows(w.rows("crm_activity"));
    expect(moves).toHaveLength(1); // one action per lead per run
    // Two signals name the same stage and the approval is the newer: it acts, and the meeting and proposal are recorded with it.
    expect(moves[0].payload.signal_key).toBe(`${L.amara}:queue:${item.id}`);
    expect([...moves[0].payload.also_signal_keys].sort()).toEqual([`${L.amara}:meeting:${m.id}`, `${L.amara}:proposal:${p.family_id}`].sort());

    // All three keys exist on the board: the proposal is the furthest-forward fact, ties go to the newest.
    const second = w.ctx("act");
    second.ctx.listApproved = async () => [item];
    const again = await runStageKeeper(second.ctx);
    // The consumed key stops the proposal; the leftover signals point at stages that are not ahead of the lead.
    expect(leadOf(w).current_stage_id).toBe(ST.post);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(1);
    expect(again.draftsOut).toBe(0);
    expect(suggestionRows(w.rows("crm_activity"))).toEqual([]);
  });

  it("after a person undoes the move, none of the three signals brings the lead back", async () => {
    const m = meeting(L.amara);
    const item = queueItem();
    const w = world({ leads: [lead(L.amara, ST.followUp)], meetings: [m], proposals: [proposal(L.amara)], activity: [drafted(L.amara, item.id)] });
    const first = w.ctx("act");
    first.ctx.listApproved = async () => [item];
    await runStageKeeper(first.ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.post);
    // The undo: the lead goes back, and the person's own stage change is on the timeline.
    leadOf(w).current_stage_id = ST.followUp;
    w.db.tables.crm_activity.push(personMove(L.amara, 9, { payload: { undoes_activity_id: "x", from_stage_id: ST.post, to_stage_id: ST.followUp } }));
    const second = w.ctx("act");
    second.ctx.listApproved = async () => [item];
    await runStageKeeper(second.ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(1);
    expect(suggestionRows(w.rows("crm_activity"))).toEqual([]);
  });

  it("each of the three keys is recorded once its signal has been the one acted on", () => {
    const signals: KeeperSignal[] = [
      { source: "meeting", meetingId: "m1", provider: "zoom", title: "t", startsAt: daysAgo(4), sensitive: false },
      { source: "proposal", familyId: "f1", version: 1, status: "sent", at: daysAgo(3) },
      { source: "queue", itemId: "q1", type: "CLIENT_EMAIL", at: daysAgo(2) },
    ];
    expect(signals.map((s) => signalKeyFor("lead", s))).toEqual(["lead:meeting:m1", "lead:proposal:f1", "lead:queue:q1"]);
    expect(signals.map(signalIdFor)).toEqual(["consult-held", "post-consult-sent", "post-consult-sent"]);
    const r = targetStageFromSignals({ currentStageId: ST.followUp }, signals, RPB, {});
    expect(r).toMatchObject({ kind: "move", signalId: "post-consult-sent" });
    expect(r.kind === "move" && r.stage.id).toBe(ST.post);
  });
});

describe("the Sprint 16 guards, re-tested for the new signals", () => {
  it("forward only: a lead already past the stage is not moved back, and nothing is written", async () => {
    const w = world({ leads: [lead(L.amara, ST.loe)], meetings: [meeting(L.amara)], proposals: [proposal(L.amara)] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.loe);
    expect(agentRows(w.rows("crm_activity"))).toEqual([]);
  });

  it("never into won, lost or nurture: a mapping that points there becomes a suggestion card", async () => {
    for (const target of ["Signed LOE / Deposit Received", "Nurture"]) {
      const w = keeperWorld({
        stages: rows(RPB),
        leads: [lead(L.amara, ST.followUp)],
        brain: [{ org_id: ORG, category: "stage_mapping", key: "post-consult-sent", body: "", data: { stage: target } }],
        extra: { crm_meeting: [], client_proposal: [proposal(L.amara)], mailbox_connection: [] },
      });
      await runStageKeeper(w.ctx("act").ctx);
      expect(leadOf(w).current_stage_id, target).toBe(ST.followUp);
      expect(suggestionRows(w.rows("crm_activity")), target).toHaveLength(1);
      expect(agentRows(w.rows("crm_activity"))).toEqual([]);
    }
  });

  it("a lead already in a won stage is never moved by a proposal", async () => {
    const w = world({ leads: [lead(L.amara, ST.signed)], proposals: [proposal(L.amara)] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.signed);
  });

  it("a sensitive meeting title holds the lead back, even from a proposal", async () => {
    const w = world({ leads: [lead(L.amara, ST.followUp)], meetings: [meeting(L.amara, { title: "Settlement dispute call" })], proposals: [proposal(L.amara)] });
    const result = await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
    expect(result.summary).toContain("1 held back as sensitive");
  });

  it("a lead a person moved in the last 7 days gets a card, not a move", async () => {
    const w = world({ leads: [lead(L.amara, ST.followUp)], activity: [personMove(L.amara, 2)], proposals: [proposal(L.amara)] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
    expect(suggestionRows(w.rows("crm_activity"))[0].payload).toMatchObject({ why: "recent-person-move", signal: "post-consult-sent", evidence: { kind: "proposal" } });
  });

  it("suggest and draft write a card with the new evidence and move nothing", async () => {
    for (const autonomy of ["suggest", "draft"] as const) {
      const w = world({ leads: [lead(L.amara, ST.followUp)], meetings: [meeting(L.amara)] });
      await runStageKeeper(w.ctx(autonomy).ctx);
      expect(leadOf(w).current_stage_id).toBe(ST.followUp);
      expect(suggestionRows(w.rows("crm_activity"))[0].payload).toMatchObject({ why: "autonomy", signal: "consult-held", evidence: { kind: "meeting" } });
    }
  });

  it("an earlier suggestion or move consumes the key; a dismissed meeting signal never returns", async () => {
    const m = meeting(L.amara);
    const w = world({ leads: [lead(L.amara, ST.followUp)], meetings: [m] });
    await runStageKeeper(w.ctx("suggest").ctx);
    expect(suggestionRows(w.rows("crm_activity"))).toHaveLength(1);
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
    expect(agentRows(w.rows("crm_activity"))).toEqual([]);
  });
});

describe("evidence carries no body, address or transcript text", () => {
  it("sentinels in every source never reach a written row, a log line or the summary", async () => {
    const item = queueItem();
    const w = world({
      leads: [lead(L.amara, ST.followUp)],
      meetings: [meeting(L.amara, { transcript: [{ text: SENTINEL }] })],
      proposals: [proposal(L.amara)],
      activity: [drafted(L.amara, item.id)],
      connections: [conn("info@firm.test")],
    });
    const { ctx, log } = w.ctx("act");
    ctx.listApproved = async () => [item];
    const result = await runStageKeeper(ctx);
    const written = JSON.stringify(log.filter((q) => q.action !== "select").map((q) => q.values));
    expect(written).not.toContain(SENTINEL);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
    expect(consoleOutput()).not.toContain(SENTINEL);
    assertOrgFenced(log);
  });

  it("evidenceOf holds only the allowed fields", () => {
    expect(evidenceOf({ source: "meeting", meetingId: "m", provider: "zoom", title: "T", startsAt: "2026-09-20T10:00:00Z", sensitive: false })).toEqual({
      kind: "meeting",
      provider: "zoom",
      title: "T",
      starts_at: "2026-09-20T10:00:00Z",
    });
    expect(evidenceOf({ source: "proposal", familyId: "f", version: 3, status: "accepted", at: "2026-09-21T10:00:00Z" })).toEqual({
      kind: "proposal",
      version: 3,
      status: "accepted",
      at: "2026-09-21T10:00:00Z",
    });
    expect(evidenceOf({ source: "queue", itemId: "q", type: "CLIENT_EMAIL", at: "2026-09-22T10:00:00Z" })).toEqual({ kind: "queue", type: "CLIENT_EMAIL", at: "2026-09-22T10:00:00Z" });
  });
});

describe("mail the firm wrote that reached a shared inbox as received", () => {
  const cc = (from: string, over: Row = {}): Row => {
    const row = mail(L.amara, "post-consult", { direction: "inbound", subject: "Your trademark consultation follow-up", ...over });
    row.payload.from = from;
    return row;
  };

  it("inbound from a firm mailbox domain counts as firm-sent for post-consult-sent", async () => {
    const row = cc("trademark@firm.test");
    const w = world({ leads: [lead(L.amara, ST.followUp)], activity: [row], connections: [conn("info@firm.test")] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.post);
    const [move] = agentRows(w.rows("crm_activity"));
    expect(move.payload.signal_key).toBe(`${L.amara}:mail:${messageIdOf(row)}`);
    expect(JSON.stringify(move.payload)).not.toContain("firm.test");
  });

  it("an outside sender does not count, and neither does a revoked or unreadable mailbox list", async () => {
    const outside = world({ leads: [lead(L.amara, ST.followUp)], activity: [cc("client@other.test")], connections: [conn("info@firm.test")] });
    await runStageKeeper(outside.ctx("act").ctx);
    expect(leadOf(outside).current_stage_id).toBe(ST.followUp);

    const revoked = world({ leads: [lead(L.amara, ST.followUp)], activity: [cc("trademark@firm.test")], connections: [conn("info@firm.test", "revoked")] });
    await runStageKeeper(revoked.ctx("act").ctx);
    expect(leadOf(revoked).current_stage_id).toBe(ST.followUp);

    const broken = world({
      leads: [lead(L.amara, ST.followUp)],
      activity: [cc("trademark@firm.test")],
      connections: [conn("info@firm.test")],
      refuse: (q) => (q.table === "mailbox_connection" ? { message: "boom" } : undefined),
    });
    const result = await runStageKeeper(broken.ctx("act").ctx);
    expect(leadOf(broken).current_stage_id).toBe(ST.followUp);
    expect(result.summary).toContain("mailbox addresses couldn't be read");
  });

  it("a gmail mailbox contributes its own address only, never the whole gmail.com domain", async () => {
    const w = world({ leads: [lead(L.amara, ST.followUp)], activity: [cc("some.client@gmail.com")], connections: [conn("owner@gmail.com")] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
    const exact = world({ leads: [lead(L.amara, ST.followUp)], activity: [cc("owner@gmail.com")], connections: [conn("owner@gmail.com")] });
    await runStageKeeper(exact.ctx("act").ctx);
    expect(leadOf(exact).current_stage_id).toBe(ST.post);
  });

  it("inbound mail that is not post-consult stays unmoved even from the firm (the type still decides)", async () => {
    const w = world({ leads: [lead(L.amara, ST.followUp)], activity: [cc("trademark@firm.test", { })], connections: [conn("info@firm.test")] });
    w.db.tables.crm_activity[0].payload.type = "other";
    await runStageKeeper(w.ctx("act").ctx);
    expect(leadOf(w).current_stage_id).toBe(ST.followUp);
  });
});
