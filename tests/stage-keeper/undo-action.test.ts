import { afterEach, describe, expect, it, vi } from "vitest";
import { runStageKeeper } from "../../src/lib/agents/stage-keeper/run";
import { undoStateFor } from "../../src/lib/stage-keeper/moves";
import { agentRows, keeperWorld, personMove, suggestionRows, type Row } from "./db";
import { agentFixture, form, loadKeeperActions } from "./actions-harness";
import { L, OTHER_ORG, S, daysAgo } from "./fixtures";

afterEach(() => vi.resetModules());

const undo = (a: Awaited<ReturnType<typeof loadKeeperActions>>["actions"], leadId: string, activityId: string) =>
  a.undoAgentMoveAction({}, form({ leadId, activityId }));

async function moved() {
  const fx = await agentFixture("act");
  const move = agentRows(fx.activity)[0];
  return { ...fx, move };
}

describe("F14 Undo", () => {
  it("moves the lead back through moveLeadStage, restores the earlier stage-entered date and logs a row naming the move it undoes", async () => {
    const { leads, activity, move } = await moved();
    expect(leads[0].current_stage_id).toBe(S.loe);
    const { actions, db } = await loadKeeperActions({ leads, activity });
    expect(await undo(actions, L.amara, move.id)).toEqual({ ok: true });

    expect(db.rows("crm_lead")[0]).toMatchObject({ current_stage_id: S.newPnc, stage_entered_at: daysAgo(10) });
    const changes = db.rows("crm_activity").filter((r) => r.type === "stage_changed");
    const back = changes[changes.length - 1];
    expect(back).toMatchObject({ actor_type: "user", lead_id: L.amara });
    expect(back.payload).toMatchObject({
      source: "stage-keeper-undo",
      undoes_activity_id: move.id,
      undoes_signal_key: move.payload.signal_key,
      from_stage_id: S.loe,
      to_stage_id: S.newPnc,
    });
    // A stage move by a person counts as contact.
    expect(db.rows("crm_lead")[0].last_activity_at).not.toBe(leads[0].last_activity_at);
  });

  it("the agent does not re-move the lead on the same signal afterwards, and writes no suggestion for it", async () => {
    const { leads, activity, move } = await moved();
    const { actions, db } = await loadKeeperActions({ leads, activity });
    await undo(actions, L.amara, move.id);

    const again = keeperWorld({ leads: db.rows("crm_lead"), activity: db.rows("crm_activity") });
    const result = await runStageKeeper(again.ctx("act").ctx);
    expect(result.itemsIn).toBe(0);
    expect(agentRows(again.rows("crm_activity"))).toHaveLength(1);
    expect(suggestionRows(again.rows("crm_activity"))).toEqual([]);
    expect(again.rows("crm_lead")[0].current_stage_id).toBe(S.newPnc);
  });

  it("a second Undo of the same move is refused", async () => {
    const { leads, activity, move } = await moved();
    const { actions, db } = await loadKeeperActions({ leads, activity });
    await undo(actions, L.amara, move.id);
    const writesBefore = db.writes.length;
    expect(await undo(actions, L.amara, move.id)).toEqual({ error: "This move has already been undone." });
    expect(db.writes.length).toBe(writesBefore);
  });

  it("is refused for a role outside the move-stage list, with nothing written", async () => {
    for (const role of ["paralegal", "social_media", "viewer"]) {
      const { leads, activity, move } = await moved();
      const { actions, db } = await loadKeeperActions({ role, leads, activity });
      const out = await undo(actions, L.amara, move.id);
      expect(out.error, role).toMatch(/permission/i);
      expect(db.writes, role).toEqual([]);
      expect(db.rows("crm_lead")[0].current_stage_id, role).toBe(S.loe);
    }
  });

  it("is allowed for every role that may move stages", async () => {
    for (const role of ["owner", "admin", "senior_admin", "intake", "law_clerk", "attorney", "clerk"]) {
      const { leads, activity, move } = await moved();
      const { actions } = await loadKeeperActions({ role, leads, activity });
      expect((await undo(actions, L.amara, move.id)).ok, role).toBe(true);
    }
  });

  it("answers 'not found' for another firm's lead, a missing activity and a row that is not a Stage Keeper move", async () => {
    const { leads, activity, move } = await moved();
    const foreign = [{ ...leads[0], org_id: OTHER_ORG }];
    const foreignActivity = activity.map((r) => ({ ...r, org_id: OTHER_ORG }));
    const a = await loadKeeperActions({ leads: foreign, activity: foreignActivity });
    expect((await undo(a.actions, L.amara, move.id)).error).toMatch(/wasn't found/);
    expect(a.db.writes).toEqual([]);

    const b = await loadKeeperActions({ leads, activity });
    expect((await undo(b.actions, L.amara, "no-such-row")).error).toMatch(/wasn't found/);
    // A person's own stage change on the same lead is not an agent move.
    const person: Row = personMove(L.amara, 1, { id: "person-1", created_at: daysAgo(1) });
    const c = await loadKeeperActions({ leads, activity: [...activity, person] });
    expect((await undo(c.actions, L.amara, "person-1")).error).toMatch(/wasn't found/);
    // The right row with the wrong lead id is not found either.
    expect((await undo(c.actions, L.kwame, move.id)).error).toMatch(/wasn't found/);
    for (const d of [b.db, c.db]) expect(d.writes).toEqual([]);
  });

  it("is refused with a clear message when the lead has moved since", async () => {
    const { leads, activity, move } = await moved();
    // A person moved it on to another stage after the agent did.
    const later = personMove(L.amara, -1, { id: "later", created_at: "2026-12-01T00:00:00.000Z", payload: { from_stage_id: S.loe, to_stage_id: S.undecided } });
    const { actions, db } = await loadKeeperActions({ leads: [{ ...leads[0], current_stage_id: S.undecided }], activity: [...activity, later] });
    expect(await undo(actions, L.amara, move.id)).toEqual({ error: "This lead has been moved since, so this can't be undone here." });
    expect(db.writes).toEqual([]);
  });

  it("is refused when the lead sits in the agent's stage again but a later change is on the timeline", async () => {
    const { leads, activity, move } = await moved();
    const back = personMove(L.amara, -1, { id: "back-and-forth", created_at: "2026-12-01T00:00:00.000Z", payload: { to_stage_id: S.loe } });
    const { actions } = await loadKeeperActions({ leads, activity: [...activity, back] });
    expect((await undo(actions, L.amara, move.id)).error).toMatch(/moved since/);
  });

  it("states: available, undone, moved-since and not-applicable", async () => {
    const { activity, move } = await moved();
    expect(undoStateFor(activity as never, move.id, S.loe)).toBe("available");
    expect(undoStateFor(activity as never, move.id, S.pnc)).toBe("moved-since");
    expect(undoStateFor(activity as never, move.id, null)).toBe("moved-since");
    expect(undoStateFor(activity as never, "nope", S.loe)).toBe("not-applicable");
    expect(undoStateFor(activity as never, activity.find((r) => r.type !== "stage_changed")!.id, S.loe)).toBe("not-applicable");
    const undone = [...(activity as never[]), { id: "u", type: "stage_changed", created_at: "2099-01-01T00:00:00Z", payload: { undoes_activity_id: move.id } }];
    expect(undoStateFor(undone, move.id, S.newPnc)).toBe("undone");
  });

  it("D2: after Undo the chip and the board filter no longer list the lead, and a second agent run leaves it alone", async () => {
    const { currentAgentMoves } = await import("../../src/lib/stage-keeper/moves");
    const { leads, activity, move } = await moved();
    const now = new Date("2026-09-25T13:00:00Z");
    expect(currentAgentMoves(activity as never, now).has(L.amara)).toBe(true);
    const { actions, db } = await loadKeeperActions({ leads, activity });
    await undo(actions, L.amara, move.id);
    // The undo row is stamped with the real clock, which is later than the agent's row.
    expect(currentAgentMoves(db.rows("crm_activity") as never, new Date()).has(L.amara)).toBe(false);
  });
});

