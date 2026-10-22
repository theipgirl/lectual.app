import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planFingerprint } from "../../src/lib/reconcile/fingerprint";
import type { PlanRow, PreviewResult } from "../../src/lib/reconcile/types";
import { S } from "./helpers";
import { L, lawmaticsStub, makeWorld } from "./world";
import { csvFile, fixtureLeads, formWith, loadActions } from "./actions-helpers";
import { prospectsPayload } from "../__fixtures__/lawmatics.fixture";

/**
 * Apply and the proposed last touch: set only when newer than what the lead held BEFORE the apply, never backwards,
 * never into the future, and only for a lead the person chose to apply. The stage move itself is unchanged.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T20:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

type Okay = Extract<PreviewResult, { ok: true }>;

async function setup(stored: Record<string, string | null> = {}) {
  const leads = fixtureLeads().map((l) => (String(l.id) in stored ? { ...l, last_activity_at: stored[String(l.id)] } : l));
  const world = makeWorld({ leads });
  const loaded = await loadActions(world, {
    lawmatics: lawmaticsStub({ prospects: () => prospectsPayload([{ id: "200", matterName: "M", firstName: "Margo", stage: "Consultation Scheduled", email: "margo@example.com" }]) }),
  });
  const preview = (await loaded.previewReconcileAction(formWith(csvFile()))) as Okay;
  if (!preview.ok) throw new Error("preview failed");
  const withTouch = (leadId: string, lastTouch: string | null): PlanRow[] => preview.plan.map((p) => (p.leadId === leadId ? { ...p, lastTouch } : p));
  const submit = (moves: Array<{ leadId: string; stageId: string }>, plan: PlanRow[] = preview.plan) =>
    loaded.applyReconcileAction({ plan, fingerprint: planFingerprint(plan), moves });
  const touchOf = (id: string) => world.db.rows("crm_lead").find((r) => r.id === id)!.last_activity_at;
  return { world, preview, withTouch, submit, touchOf, ...loaded };
}

const AMARA = { leadId: L.amara, stageId: S.consult };
const PRIYA = { leadId: L.priya, stageId: S.prelim }; // already in Preliminary Search

describe("the preview proposes a last touch", () => {
  it("carries the newest dated evidence on each row and in the plan", async () => {
    const t = await setup();
    const amara = t.preview.view.rows.find((r) => r.leadId === L.amara)!;
    expect(amara.lastTouch).toBe("2026-09-14T00:00:00.000Z");
    expect(t.preview.plan.find((p) => p.leadId === L.amara)?.lastTouch).toBe("2026-09-14T00:00:00.000Z");
  });

  it("the fingerprint covers it: changing it after the preview makes the plan stale and writes nothing", async () => {
    const t = await setup();
    const forged = t.withTouch(L.amara, "2026-10-01T00:00:00.000Z");
    const r = await t.applyReconcileAction({ plan: forged, fingerprint: t.preview.fingerprint, moves: [AMARA] });
    expect(r).toMatchObject({ ok: false, stale: true });
    expect(t.world.db.writes).toEqual([]);
  });
});

describe("applying the last touch", () => {
  it("sets it to the proposed date when that is newer than the stored value, instead of leaving 'now' from the move", async () => {
    const t = await setup({ [L.amara]: "2026-08-01T00:00:00.000Z" });
    const plan = t.withTouch(L.amara, "2026-10-18T09:00:00.000Z");
    const r = await t.submit([AMARA], plan);
    expect(r).toMatchObject({ ok: true, totals: { moved: 1 } });
    if (r.ok) expect(r.outcomes[0]).toMatchObject({ status: "moved", lastTouchSet: true });
    expect(t.touchOf(L.amara)).toBe("2026-10-18T09:00:00.000Z");
  });

  it("never moves it backwards: an older proposal leaves a newer stored value alone", async () => {
    const t = await setup({ [L.priya]: "2026-10-20T00:00:00.000Z" });
    const plan = t.withTouch(L.priya, "2026-10-01T00:00:00.000Z");
    const r = await t.submit([PRIYA], plan);
    expect(r).toMatchObject({ ok: true, totals: { already: 1, moved: 0 } });
    if (r.ok) expect(r.outcomes[0]).toMatchObject({ status: "already", lastTouchSet: false });
    expect(t.touchOf(L.priya)).toBe("2026-10-20T00:00:00.000Z");
  });

  it("an equal date is not newer", async () => {
    const t = await setup({ [L.priya]: "2026-10-01T00:00:00.000Z" });
    const r = await t.submit([PRIYA], t.withTouch(L.priya, "2026-10-01T00:00:00.000Z"));
    if (r.ok) expect(r.outcomes[0]).toMatchObject({ lastTouchSet: false });
  });

  it("never into the future", async () => {
    const t = await setup({ [L.priya]: "2026-08-01T00:00:00.000Z" });
    const r = await t.submit([PRIYA], t.withTouch(L.priya, "2026-12-25T00:00:00.000Z"));
    if (r.ok) expect(r.outcomes[0]).toMatchObject({ status: "already", lastTouchSet: false });
    expect(t.touchOf(L.priya)).toBe("2026-08-01T00:00:00.000Z");
  });

  it("a lead with no stored touch takes the proposed one", async () => {
    const t = await setup({ [L.priya]: null });
    const r = await t.submit([PRIYA], t.withTouch(L.priya, "2026-10-10T00:00:00.000Z"));
    if (r.ok) expect(r.outcomes[0]).toMatchObject({ lastTouchSet: true });
    expect(t.touchOf(L.priya)).toBe("2026-10-10T00:00:00.000Z");
  });

  it("no proposed touch: nothing is written for it", async () => {
    const t = await setup({ [L.priya]: "2026-08-01T00:00:00.000Z" });
    const r = await t.submit([PRIYA], t.withTouch(L.priya, null));
    if (r.ok) expect(r.outcomes[0]).toMatchObject({ lastTouchSet: false });
    expect(t.world.db.writes.filter((w) => w.table === "crm_lead")).toEqual([]);
  });

  it("only for a lead the person applied: an unchosen lead's touch is not written", async () => {
    const t = await setup({ [L.priya]: "2026-08-01T00:00:00.000Z", [L.amara]: "2026-08-01T00:00:00.000Z" });
    await t.submit([AMARA], t.withTouch(L.priya, "2026-10-10T00:00:00.000Z"));
    expect(t.touchOf(L.priya)).toBe("2026-08-01T00:00:00.000Z");
  });

  it("a garbled date is ignored", async () => {
    const t = await setup({ [L.priya]: "2026-08-01T00:00:00.000Z" });
    const r = await t.submit([PRIYA], t.withTouch(L.priya, "last tuesday"));
    if (r.ok) expect(r.outcomes[0]).toMatchObject({ lastTouchSet: false });
    expect(t.touchOf(L.priya)).toBe("2026-08-01T00:00:00.000Z");
  });

  it("a row whose move fails writes no touch", async () => {
    const t = await setup({ [L.amara]: "2026-08-01T00:00:00.000Z" });
    t.move.mockRejectedValueOnce(new Error("boom"));
    await t.submit([AMARA, PRIYA], t.withTouch(L.amara, "2026-10-18T09:00:00.000Z"));
    expect(t.touchOf(L.amara)).toBe("2026-08-01T00:00:00.000Z");
  });
});
