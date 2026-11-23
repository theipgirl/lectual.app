import { describe, expect, it } from "vitest";
import { runStageKeeper } from "../../src/lib/agents/stage-keeper/run";
import { bumpHeldConsults } from "../../src/lib/stage-keeper/held-consult";
import { agentRows, event, keeperWorld, lead, suggestionRows } from "./db";
import { L, ORG, S, daysAgo } from "./fixtures";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NOW } from "../agents/helpers";

/** (41) A consult the Lawmatics daily sync stored: a suggestion card, never a move. Invented people only. */
const lmEvent = (leadId: string, over: Record<string, unknown> = {}) =>
  event(leadId, { source: "lawmatics", external_id: `lmsync:${Math.random().toString(36).slice(2)}`, title: "30 Minute Consultation - Wren Tester", location: null, organizer_email: null, attendee_emails: null, ...over });

describe("Stage Keeper and Lawmatics consults (41)", () => {
  it("a linked future Lawmatics consult gives a suggestion card, never a move, even at autonomy act", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], events: [lmEvent(L.amara)] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(w.db.tables.crm_lead.find((l) => l.id === L.amara)!.current_stage_id).toBe(S.newPnc);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(0);
    const [card] = suggestionRows(w.rows("crm_activity"));
    expect(card.payload).toMatchObject({ to_stage_id: S.consult, why: "lawmatics-consult" });
    expect(card.payload.signal_key).toMatch(new RegExp(`^${L.amara}:calendar:`));
  });

  it("a Lost, Won or Nurture lead gives nothing at all", async () => {
    for (const stage of [S.lost, S.nurture, S.signed]) {
      const w = keeperWorld({ leads: [lead(L.amara, stage)], events: [lmEvent(L.amara)] });
      await runStageKeeper(w.ctx("act").ctx);
      expect(agentRows(w.rows("crm_activity"))).toHaveLength(0);
      expect(suggestionRows(w.rows("crm_activity"))).toHaveLength(0);
      expect(w.db.tables.crm_lead[0].current_stage_id).toBe(stage);
    }
  });

  it("a sensitive title gives nothing", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], events: [lmEvent(L.amara, { title: "Settlement call - consult" })] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(0);
    expect(suggestionRows(w.rows("crm_activity"))).toHaveLength(0);
  });

  it("a legacy Lawmatics row (no lmsync: prefix) gives nothing", async () => {
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], events: [event(L.amara, { source: "lawmatics", external_id: null, lawmatics_id: "777" })] });
    await runStageKeeper(w.ctx("act").ctx);
    expect(agentRows(w.rows("crm_activity"))).toHaveLength(0);
    expect(suggestionRows(w.rows("crm_activity"))).toHaveLength(0);
  });

  it("the same call in Outlook and Lawmatics: the Outlook signal acts and the Lawmatics key is recorded with it", async () => {
    const lm = lmEvent(L.amara);
    const w = keeperWorld({ leads: [lead(L.amara, S.newPnc)], events: [event(L.amara), lm] });
    await runStageKeeper(w.ctx("act").ctx);
    const [move] = agentRows(w.rows("crm_activity"));
    expect(move.payload.to_stage_id).toBe(S.consult);
    expect(move.payload.also_signal_keys).toContain(`${L.amara}:calendar:${lm.id}`);
  });

  it("the held-consult last touch reads the sync's own Lawmatics rows (forward only)", async () => {
    const { fakeAdmin } = await import("../mailbox/fake-db");
    const { keeperHandler } = await import("./db");
    const db = { tables: { crm_lead: [lead(L.amara, S.newPnc, { last_activity_at: daysAgo(6) })], crm_calendar_event: [lmEvent(L.amara, { starts_at: daysAgo(1.05), ends_at: daysAgo(1) })] } };
    const { client } = fakeAdmin(keeperHandler(db as never));
    const r = await bumpHeldConsults(client as unknown as SupabaseClient, ORG, NOW);
    expect(r.bumped).toBe(1);
  });

  it("(11) sources are independent: a failed Lawmatics read keeps the Outlook consult acting, and the reverse", async () => {
    const isSource = (src: string) => (q: { table: string; filters: Array<{ column: string; value: unknown }> }) =>
      q.table === "crm_calendar_event" && q.filters.some((f) => f.column === "source" && f.value === src) ? { message: "down" } : undefined;
    const a = keeperWorld({ leads: [lead(L.amara, S.newPnc)], events: [event(L.amara)], refuse: isSource("lawmatics") as never });
    const ra = await runStageKeeper(a.ctx("act").ctx);
    expect(agentRows(a.rows("crm_activity"))).toHaveLength(1);
    expect(ra.summary).toContain("Lawmatics consults couldn't be read this run.");
    const b = keeperWorld({ leads: [lead(L.amara, S.newPnc)], events: [lmEvent(L.amara)], refuse: isSource("outlook") as never });
    await runStageKeeper(b.ctx("act").ctx);
    expect(suggestionRows(b.rows("crm_activity"))).toHaveLength(1);
  });

  it("(11) the held-consult bump uses Outlook when the Lawmatics read fails, and says which half failed", async () => {
    const { fakeAdmin } = await import("../mailbox/fake-db");
    const { keeperHandler } = await import("./db");
    const db = {
      tables: { crm_lead: [lead(L.amara, S.newPnc, { last_activity_at: daysAgo(6) })], crm_calendar_event: [event(L.amara, { starts_at: daysAgo(1.05), ends_at: daysAgo(1) })] },
      refuse: (q: { table: string; filters: Array<{ column: string; value: unknown }> }) =>
        q.table === "crm_calendar_event" && q.filters.some((f) => f.column === "source" && f.value === "lawmatics") ? { message: "down" } : undefined,
    };
    const { client } = fakeAdmin(keeperHandler(db as never));
    const r = await bumpHeldConsults(client as unknown as SupabaseClient, ORG, NOW);
    expect(r).toMatchObject({ state: "ok", bumped: 1, partial: "lawmatics" });
  });
});
