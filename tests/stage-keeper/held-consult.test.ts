import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bumpHeldConsults } from "../../src/lib/stage-keeper/held-consult";
import { fakeAdmin } from "../mailbox/fake-db";
import { assertOrgFenced, NOW } from "../agents/helpers";
import { event, keeperHandler, lead, type KeeperDb, type Row } from "./db";
import { L, ORG, OTHER_ORG, S, daysAgo, daysAhead } from "./fixtures";

function setup(leads: Row[], events: Row[], refuse?: KeeperDb["refuse"]) {
  const db: KeeperDb = { tables: { crm_lead: leads, crm_calendar_event: events }, refuse };
  const { client, log } = fakeAdmin(keeperHandler(db));
  return { db, log, admin: client as unknown as SupabaseClient };
}
const held = (leadId: string | null, endDaysAgo: number, over: Row = {}) =>
  event(leadId, { starts_at: daysAgo(endDaysAgo + 0.05), ends_at: daysAgo(endDaysAgo), ...over });

describe("F17 a held consult is contact", () => {
  it("moves a linked, ended consult's lead forward to the end of the call", async () => {
    const end = daysAgo(1);
    const w = setup([lead(L.amara, S.newPnc, { last_activity_at: daysAgo(6) })], [held(L.amara, 1)]);
    expect(await bumpHeldConsults(w.admin, ORG, NOW)).toEqual({ orgId: ORG, state: "ok", bumped: 1 });
    expect(w.db.tables.crm_lead[0].last_activity_at).toBe(end);
  });

  it("never moves it backwards: a lead touched after the call keeps its later touch", async () => {
    const w = setup([lead(L.amara, S.newPnc, { last_activity_at: daysAgo(0.5) })], [held(L.amara, 1)]);
    expect((await bumpHeldConsults(w.admin, ORG, NOW)).bumped).toBe(0);
    expect(w.db.tables.crm_lead[0].last_activity_at).toBe(daysAgo(0.5));
    expect(w.log.some((q) => q.action === "update")).toBe(false);
  });

  it("the update itself is conditional, so a note written between the read and the write is not overwritten", async () => {
    const w = setup([lead(L.amara, S.newPnc, { last_activity_at: daysAgo(6) })], [held(L.amara, 1)]);
    await bumpHeldConsults(w.admin, ORG, NOW);
    const update = w.log.find((q) => q.action === "update")!;
    expect(update.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "lt", column: "last_activity_at" })]));
  });

  it("a lead with no last touch yet gets one", async () => {
    const w = setup([lead(L.amara, S.newPnc, { last_activity_at: null })], [held(L.amara, 2)]);
    expect((await bumpHeldConsults(w.admin, ORG, NOW)).bumped).toBe(1);
    expect(w.db.tables.crm_lead[0].last_activity_at).toBe(daysAgo(2));
    expect(w.log.find((q) => q.action === "update")!.filters).toEqual(expect.arrayContaining([expect.objectContaining({ op: "is", column: "last_activity_at", value: null })]));
  });

  it("uses the newest ended consult when a lead has several", async () => {
    const w = setup([lead(L.amara, S.newPnc, { last_activity_at: daysAgo(6) })], [held(L.amara, 4), held(L.amara, 1)]);
    await bumpHeldConsults(w.admin, ORG, NOW);
    expect(w.db.tables.crm_lead[0].last_activity_at).toBe(daysAgo(1));
  });

  it("a future consult, an unlinked one, a non-consult event and a call still in progress do not touch anyone", async () => {
    const w = setup(
      [lead(L.amara, S.newPnc, { last_activity_at: daysAgo(6) }), lead(L.kwame, S.newPnc, { last_activity_at: daysAgo(6) }), lead(L.priya, S.newPnc, { last_activity_at: daysAgo(6) })],
      [
        event(L.amara, { starts_at: daysAhead(2), ends_at: daysAhead(2) }),
        held(null, 1),
        held(L.kwame, 1, { is_consult: false }),
        event(L.priya, { starts_at: daysAgo(0.01), ends_at: daysAhead(0.1) }),
      ],
    );
    expect(await bumpHeldConsults(w.admin, ORG, NOW)).toEqual({ orgId: ORG, state: "ok", bumped: 0 });
    expect(w.log.some((q) => q.action === "update")).toBe(false);
  });

  it("is fenced to the firm: another firm's events and leads are never read or written", async () => {
    const w = setup(
      [lead(L.amara, S.newPnc, { last_activity_at: daysAgo(6) }), lead(L.other, S.newPnc, { org_id: OTHER_ORG, last_activity_at: daysAgo(6) })],
      [held(L.amara, 1), { ...held(L.other, 1), org_id: OTHER_ORG }],
    );
    await bumpHeldConsults(w.admin, ORG, NOW);
    expect(() => assertOrgFenced(w.log)).not.toThrow();
    expect(w.db.tables.crm_lead[1].last_activity_at).toBe(daysAgo(6));
  });

  it("before lectual 0098 it says 'database update needed' and does not throw", async () => {
    for (const code of ["42703", "PGRST204"]) {
      const w = setup([lead(L.amara, S.newPnc)], [held(L.amara, 1)], (q) => (q.table === "crm_calendar_event" ? { message: 'column "is_consult" does not exist', code } : undefined));
      expect(await bumpHeldConsults(w.admin, ORG, NOW)).toEqual({ orgId: ORG, state: "database-update-needed", bumped: 0 });
    }
  });

  it("any other failure is an error result, never an exception and never 'no consults'", async () => {
    const readFails = setup([lead(L.amara, S.newPnc)], [held(L.amara, 1)], (q) => (q.table === "crm_calendar_event" ? { message: "boom" } : undefined));
    expect((await bumpHeldConsults(readFails.admin, ORG, NOW)).state).toBe("error");
    const writeFails = setup([lead(L.amara, S.newPnc, { last_activity_at: daysAgo(6) })], [held(L.amara, 1)], (q) => (q.table === "crm_lead" && q.action === "update" ? { message: "boom" } : undefined));
    expect((await bumpHeldConsults(writeFails.admin, ORG, NOW)).state).toBe("error");
    const throws = { from: () => { throw new Error("down"); } } as unknown as SupabaseClient;
    expect(await bumpHeldConsults(throws, ORG, NOW)).toEqual({ orgId: ORG, state: "error", bumped: 0 });
  });
});
