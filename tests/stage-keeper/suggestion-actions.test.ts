import { afterEach, describe, expect, it, vi } from "vitest";
import { runStageKeeper } from "../../src/lib/agents/stage-keeper/run";
import { pendingStageSuggestions, decidedSuggestionIds } from "../../src/lib/stage-keeper/moves";
import { agentRows, keeperWorld, stageRows, suggestionRows, type Row } from "./db";
import { agentFixture, form, loadKeeperActions } from "./actions-harness";
import { L, ORG, OTHER_ORG, S } from "./fixtures";

afterEach(() => vi.resetModules());

type Loaded = Awaited<ReturnType<typeof loadKeeperActions>>["actions"];
const accept = (a: Loaded, activityId: string, leadId: string = L.amara) => a.acceptStageSuggestionAction({}, form({ leadId, activityId }));
const dismiss = (a: Loaded, activityId: string, leadId: string = L.amara) => a.dismissStageSuggestionAction({}, form({ leadId, activityId }));
const reviewRows = (rows: Row[]) => rows.filter((r) => r.type === "ai_insight" && r.payload?.source === "stage-keeper-review");

async function card(autonomy: "suggest" | "draft" = "suggest", init = {}) {
  const fx = await agentFixture(autonomy, init);
  return { ...fx, card: suggestionRows(fx.activity)[0] };
}

describe("F15 Accept", () => {
  it("moves through moveLeadStage, stamps the evidence date, logs the review row and clears the card", async () => {
    const { leads, activity, card: c } = await card();
    const { actions, db } = await loadKeeperActions({ leads, activity });
    expect(pendingStageSuggestions(db.rows("crm_activity") as never)).toHaveLength(1);

    expect(await accept(actions, c.id)).toEqual({ ok: true });
    expect(db.rows("crm_lead")[0]).toMatchObject({ current_stage_id: S.loe, stage_entered_at: new Date(c.payload.evidence.at).toISOString() });
    const move = db.rows("crm_activity").filter((r) => r.type === "stage_changed").pop()!;
    expect(move).toMatchObject({ actor_type: "user" });
    expect(move.payload).toMatchObject({ source: "stage-keeper-accept", accepted_suggestion_id: c.id, to_stage_id: S.loe, from_stage_id: S.newPnc });
    const [review] = reviewRows(db.rows("crm_activity"));
    expect(review).toMatchObject({ lead_id: L.amara, actor_type: "user" });
    expect(review.payload).toMatchObject({ source: "stage-keeper-review", suggestion_id: c.id, decision: "apply", signal_key: c.payload.signal_key });
    expect(pendingStageSuggestions(db.rows("crm_activity") as never)).toEqual([]);
  });

  it("is refused for a role that may not move stages: nothing moves, nothing is logged", async () => {
    for (const role of ["paralegal", "social_media", "viewer"]) {
      const { leads, activity, card: c } = await card();
      const { actions, db } = await loadKeeperActions({ role, leads, activity });
      expect((await accept(actions, c.id)).error, role).toMatch(/permission/i);
      expect(db.writes, role).toEqual([]);
    }
  });

  it("refuses a stale suggestion: the lead is no longer in the stage it was suggested from", async () => {
    const { leads, activity, card: c } = await card();
    const { actions, db } = await loadKeeperActions({ leads: [{ ...leads[0], current_stage_id: S.pnc }], activity });
    expect((await accept(actions, c.id)).error).toMatch(/out of date/);
    expect(db.rows("crm_lead")[0].current_stage_id).toBe(S.pnc);
    expect(reviewRows(db.rows("crm_activity"))).toEqual([]);
    expect(db.writes).toEqual([]);
  });

  it("refuses when the destination is no longer a valid destination (gone, or no longer further along)", async () => {
    const { leads, activity, card: c } = await card();
    const gone = await loadKeeperActions({ leads, activity, stages: stageRows().filter((s) => s.id !== S.loe) });
    expect((await accept(gone.actions, c.id)).error).toMatch(/out of date/);
    const reordered = stageRows().map((s) => (s.id === S.loe ? { ...s, order_index: 0 } : s));
    const back = await loadKeeperActions({ leads, activity, stages: reordered });
    expect((await accept(back.actions, c.id)).error).toMatch(/out of date/);
    for (const d of [gone.db, back.db]) {
      expect(d.writes).toEqual([]);
      expect(d.rows("crm_lead")[0].current_stage_id).toBe(S.newPnc);
    }
  });

  it("refuses a second decision on the same suggestion, whichever came first", async () => {
    const { leads, activity, card: c } = await card();
    const { actions, db } = await loadKeeperActions({ leads, activity });
    await accept(actions, c.id);
    const writes = db.writes.length;
    expect((await accept(actions, c.id)).error).toBe("This suggestion has already been decided.");
    expect((await dismiss(actions, c.id)).error).toBe("This suggestion has already been decided.");
    expect(db.writes.length).toBe(writes);

    const second = await card();
    const loaded = await loadKeeperActions({ leads: second.leads, activity: second.activity });
    await dismiss(loaded.actions, second.card.id);
    expect((await accept(loaded.actions, second.card.id)).error).toBe("This suggestion has already been decided.");
    expect(loaded.db.rows("crm_lead")[0].current_stage_id).toBe(S.newPnc);
  });

  it("answers 'not found' for another firm's lead, a missing row and a row that is not a suggestion", async () => {
    const { leads, activity, card: c } = await card();
    const foreign = await loadKeeperActions({ leads: [{ ...leads[0], org_id: OTHER_ORG }], activity: activity.map((r) => ({ ...r, org_id: OTHER_ORG })) });
    expect((await accept(foreign.actions, c.id)).error).toMatch(/wasn't found/);
    expect((await dismiss(foreign.actions, c.id)).error).toMatch(/wasn't found/);
    expect(foreign.db.writes).toEqual([]);

    const ok = await loadKeeperActions({ leads, activity });
    expect((await accept(ok.actions, "missing")).error).toMatch(/wasn't found/);
    const mailId = activity.find((r) => r.type === "email_sent")!.id;
    expect((await accept(ok.actions, mailId)).error).toMatch(/wasn't found/);
    expect((await accept(ok.actions, c.id, L.kwame)).error).toMatch(/wasn't found/);
    expect(ok.db.writes).toEqual([]);
  });
});

describe("F15 Dismiss", () => {
  it("logs the review, moves nothing and does not touch the lead's last touch", async () => {
    const { leads, activity, card: c } = await card();
    const { actions, db } = await loadKeeperActions({ leads, activity });
    expect(await dismiss(actions, c.id)).toEqual({ ok: true });
    expect(db.rows("crm_lead")[0]).toMatchObject({ current_stage_id: S.newPnc, last_activity_at: leads[0].last_activity_at });
    expect(db.writes.filter((w) => w.table === "crm_lead")).toEqual([]);
    expect(reviewRows(db.rows("crm_activity"))[0].payload).toMatchObject({ decision: "dismiss", suggestion_id: c.id });
    expect(pendingStageSuggestions(db.rows("crm_activity") as never)).toEqual([]);
    expect(decidedSuggestionIds(db.rows("crm_activity") as never).has(c.id)).toBe(true);
  });

  it("is refused for a role that may not move stages", async () => {
    const { leads, activity, card: c } = await card();
    const { actions, db } = await loadKeeperActions({ role: "viewer", leads, activity });
    expect((await dismiss(actions, c.id)).error).toMatch(/permission/i);
    expect(db.writes).toEqual([]);
  });
});

describe("D3 the suggest round trip", () => {
  it("a signal produces a pending card, Accept moves the lead and clears it, and a later run does not suggest again", async () => {
    const { leads, activity } = await card("suggest");
    const loaded = await loadKeeperActions({ leads, activity });
    const cardId = suggestionRows(loaded.db.rows("crm_activity"))[0].id;
    await accept(loaded.actions, cardId);

    const later = keeperWorld({ leads: loaded.db.rows("crm_lead"), activity: loaded.db.rows("crm_activity") });
    const result = await runStageKeeper(later.ctx("suggest").ctx);
    expect(result.itemsIn).toBe(0);
    expect(suggestionRows(later.rows("crm_activity"))).toHaveLength(1);
    expect(later.rows("crm_lead")[0].current_stage_id).toBe(S.loe);
  });

  it("a dismissed card never returns, even under act", async () => {
    const { leads, activity } = await card("suggest");
    const loaded = await loadKeeperActions({ leads, activity });
    await dismiss(loaded.actions, suggestionRows(loaded.db.rows("crm_activity"))[0].id);
    const later = keeperWorld({ leads: loaded.db.rows("crm_lead"), activity: loaded.db.rows("crm_activity") });
    for (const autonomy of ["suggest", "act"] as const) {
      expect((await runStageKeeper(later.ctx(autonomy).ctx)).itemsIn, autonomy).toBe(0);
    }
    expect(later.rows("crm_lead")[0].current_stage_id).toBe(S.newPnc);
    expect(agentRows(later.rows("crm_activity"))).toEqual([]);
  });
});

describe("D4 the won guard end to end", () => {
  const brain: Row[] = [{ org_id: ORG, category: "stage_mapping", key: "loe-invoice-sent", body: "", data: { stage: "Signed LOE / Deposit Received" } }];

  it("the agent only suggests the won stage; a person accepting it goes through the existing person path, with the matter handoff", async () => {
    const fx = await agentFixture("act", { brain });
    expect(fx.leads[0].current_stage_id).toBe(S.newPnc);
    expect(agentRows(fx.activity)).toEqual([]);
    const c = suggestionRows(fx.activity)[0];
    expect(c.payload).toMatchObject({ why: "won", to_stage_id: S.signed });

    const { actions, db, ensureMatterForLead, stopLeadSequencesAsStaff } = await loadKeeperActions({ leads: fx.leads, activity: fx.activity });
    // Nothing of the handoff happened on the agent's side.
    expect(ensureMatterForLead).not.toHaveBeenCalled();
    expect(stopLeadSequencesAsStaff).not.toHaveBeenCalled();

    expect(await accept(actions, c.id)).toEqual({ ok: true });
    expect(db.rows("crm_lead")[0].current_stage_id).toBe(S.signed);
    expect(ensureMatterForLead).toHaveBeenCalledWith(L.amara);
    expect(stopLeadSequencesAsStaff).toHaveBeenCalledWith(expect.objectContaining({ leadIds: [L.amara], reason: "client" }));
  });
});

