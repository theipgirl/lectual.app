import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writesTo } from "../matters/helpers/fake-db";
import { planFingerprint } from "../../src/lib/reconcile/fingerprint";
import { MAX_MOVES_PER_APPLY, RECONCILE_MESSAGES as MSG } from "../../src/lib/reconcile/rules";
import type { PlanRow, PreviewResult } from "../../src/lib/reconcile/types";
import { OTHER_ORG, S, SECRET } from "./helpers";
import { L, foreignLead, lawmaticsStub, leadRow, makeWorld } from "./world";
import { csvFile, fixtureLeads, formWith, loadActions } from "./actions-helpers";
import { prospectsPayload } from "../__fixtures__/lawmatics.fixture";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => c.map(String).join(" ")).join("\n");
const ALLOWED = ["owner", "admin", "senior_admin"] as const;
const REFUSED = ["intake", "paralegal", "law_clerk", "attorney", "clerk", "viewer", "social_media"] as const;

type Okay = Extract<PreviewResult, { ok: true }>;

/** A real preview over the fixture, so the plan and its fingerprint are the ones the screen would hold. */
async function setup(over: Parameters<typeof makeWorld>[0] = {}) {
  const world = makeWorld({ leads: fixtureLeads(), ...over });
  const loaded = await loadActions(world, {
    lawmatics: lawmaticsStub({ prospects: () => prospectsPayload([{ id: "200", matterName: "M", firstName: "Margo", stage: "Consultation Scheduled", email: "margo@example.com" }]) }),
  });
  const preview = await loaded.previewReconcileAction(formWith(csvFile()));
  if (!preview.ok) throw new Error(preview.error);
  const submit = (moves: Array<{ leadId: string; stageId: string }>, edit: { plan?: PlanRow[]; fingerprint?: string } = {}) =>
    loaded.applyReconcileAction({ plan: edit.plan ?? preview.plan, fingerprint: edit.fingerprint ?? preview.fingerprint, moves });
  const refingerprint = (plan: PlanRow[]) => planFingerprint(plan);
  return { world, ...loaded, preview: preview as Okay, submit, refingerprint };
}

const stageOf = (world: ReturnType<typeof makeWorld>, id: string) => world.db.rows("crm_lead").find((r) => r.id === id)!.current_stage_id;
const AMARA = { leadId: L.amara, stageId: S.pnc };
const MARGO = { leadId: L.margo, stageId: S.consult };

describe("applyReconcileAction: who may apply", () => {
  it.each(ALLOWED)("%s can apply", async (role) => {
    const t = await setup({ role });
    const r = await t.submit([AMARA]);
    expect(r).toMatchObject({ ok: true, totals: { moved: 1, already: 0, failed: 0 } });
    expect(stageOf(t.world, L.amara)).toBe(S.pnc);
  });

  it.each(REFUSED)("refuses %s with a sentence, reads no lead and writes nothing", async (role) => {
    const t = await setup();
    t.world.db.role = role;
    t.world.db.froms.length = 0;
    const r = await t.submit([AMARA]);
    expect(r).toEqual({ ok: false, error: MSG.notAllowed });
    expect(t.world.db.froms).toEqual([]);
    expect(t.world.db.writes).toEqual([]);
    expect(t.move).not.toHaveBeenCalled();
  });

  it("fails closed with an unresolvable role and with no session", async () => {
    for (const opts of [{ role: null }, { client: { roleError: true } }, { client: { signedIn: false } }] as const) {
      const world = makeWorld({ leads: fixtureLeads(), ...opts });
      const loaded = await loadActions(world);
      const r = await loaded.applyReconcileAction({ plan: [], fingerprint: "x", moves: [AMARA] });
      expect(r.ok).toBe(false);
      expect(world.db.froms).toEqual([]);
      expect(loaded.move).not.toHaveBeenCalled();
      expect(JSON.stringify(r)).not.toContain("SECRET");
    }
  });

  it("re-resolves the role on every call", async () => {
    const t = await setup();
    t.world.db.role = "viewer";
    expect((await t.submit([AMARA])).ok).toBe(false);
    t.world.db.role = "owner";
    expect((await t.submit([AMARA])).ok).toBe(true);
    expect(t.world.db.rpcCalls.filter((n) => n === "current_org_role").length).toBeGreaterThanOrEqual(2);
  });
});

describe("applyReconcileAction: every write is the existing stage move", () => {
  it("calls moveLeadStage once per chosen row with the lead id, the target stage and the sheet's date", async () => {
    const t = await setup();
    const r = await t.submit([AMARA, MARGO]);
    expect(r.ok).toBe(true);
    expect(t.move.mock.calls).toEqual([
      [L.amara, S.pnc, "2026-09-14T00:00:00.000Z"],
      [L.margo, S.consult, "2026-09-03T00:00:00.000Z"],
    ]);
    // The move's own logging: one stage_changed row per lead, carrying the date.
    const rows = t.world.db.activity().filter((a) => a.type === "stage_changed");
    expect(rows.map((a) => a.lead_id).sort()).toEqual([L.amara, L.margo].sort());
    expect(rows.find((a) => a.lead_id === L.amara)!.payload).toMatchObject({ from_stage_id: S.followUp, to_stage_id: S.pnc, evidence_at: "2026-09-14T00:00:00.000Z" });
  });

  it("the only table written to directly is the lead (by the move) and the timeline (by the move's logging)", async () => {
    const t = await setup();
    await t.submit([AMARA, MARGO]);
    const tables = new Set(t.world.db.writes.map((w) => w.table));
    expect([...tables].sort()).toEqual(["crm_activity", "crm_lead"]);
  });

  it("touches nothing for a lead that was not chosen", async () => {
    const t = await setup();
    await t.submit([AMARA]);
    expect(stageOf(t.world, L.margo)).toBe(S.pnc);
    expect(t.move).toHaveBeenCalledTimes(1);
  });

  it("revalidates the intake and leads pages", async () => {
    const t = await setup();
    await t.submit([AMARA]);
    expect(t.revalidated).toEqual(["/dashboard/intake/", "/dashboard/leads/", `/dashboard/leads/${L.amara}/`]);
  });
});

describe("applyReconcileAction: the evidence date", () => {
  const entered = (t: Awaited<ReturnType<typeof setup>>, id: string) => t.world.db.rows("crm_lead").find((r) => r.id === id)!.stage_entered_at;

  it("stamps stage_entered_at with the sheet's date when the sheet's stage is applied", async () => {
    const t = await setup();
    await t.submit([AMARA]);
    expect(entered(t, L.amara)).toBe("2026-09-14T00:00:00.000Z");
    const update = writesTo(t.world.db, "crm_lead").find((w) => w.op === "update")!.payload as Record<string, unknown>;
    expect(update.stage_entered_at).toBe("2026-09-14T00:00:00.000Z");
    expect(update.last_activity_at).not.toBe(update.stage_entered_at);
  });

  it("a stage the person picked carries no date: it stamps now", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    const t = await setup();
    await t.submit([{ leadId: L.amara, stageId: S.loe }]);
    expect(t.move).toHaveBeenCalledWith(L.amara, S.loe, null);
    expect(entered(t, L.amara)).toBe("2026-10-21T15:00:00.000Z");
    const row = t.world.db.activity().find((a) => a.type === "stage_changed")!;
    expect(row.payload).not.toHaveProperty("evidence_at");
  });

  it("a row with no date stamps now", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    const t = await setup();
    const plan = t.preview.plan.map((p) => (p.leadId === L.amara ? { ...p, evidenceDate: null } : p));
    await t.submit([AMARA], { plan, fingerprint: t.refingerprint(plan) });
    expect(entered(t, L.amara)).toBe("2026-10-21T15:00:00.000Z");
  });

  it.each([
    ["a future date", "2027-06-01T00:00:00.000Z"],
    ["an invalid date", "not-a-date"],
  ])("%s in the plan is ignored: the move stamps now", async (_label, bad) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
    const t = await setup();
    const plan = t.preview.plan.map((p) => (p.leadId === L.amara ? { ...p, evidenceDate: bad } : p));
    const r = await t.submit([AMARA], { plan, fingerprint: t.refingerprint(plan) });
    expect(r.ok).toBe(true);
    expect(entered(t, L.amara)).toBe("2026-10-21T15:00:00.000Z");
  });
});

describe("applyReconcileAction: a stale plan is refused and writes nothing", () => {
  const planWith = (t: Awaited<ReturnType<typeof setup>>, id: string, change: Partial<PlanRow>) => t.preview.plan.map((p) => (p.leadId === id ? { ...p, ...change } : p));

  it("a changed fingerprint", async () => {
    const t = await setup();
    const r = await t.submit([AMARA], { fingerprint: "0".repeat(64) });
    expect(r).toEqual({ ok: false, error: MSG.stale, stale: true });
    expect(t.world.db.writes).toEqual([]);
    expect(t.move).not.toHaveBeenCalled();
  });

  it.each([
    ["the stage it was in", { fromStageId: S.loe }],
    ["the stage it proposed", { proposedStageId: S.loe }],
    ["the date", { evidenceDate: "2026-01-01T00:00:00.000Z" }],
    ["the confidence", { confidence: "conflict" as const }],
    ["the lead", { leadId: L.priya }],
  ])("a submitted row altered after the preview: %s", async (_label, change) => {
    const t = await setup();
    const r = await t.submit([AMARA], { plan: planWith(t, L.amara, change) });
    expect(r).toMatchObject({ ok: false, error: MSG.stale, stale: true });
    expect(t.world.db.writes).toEqual([]);
    expect(t.move).not.toHaveBeenCalled();
  });

  it("a row dropped or added", async () => {
    const t = await setup();
    expect((await t.submit([AMARA], { plan: t.preview.plan.slice(1) })).ok).toBe(false);
    expect((await t.submit([AMARA], { plan: [...t.preview.plan, { ...t.preview.plan[0], leadId: L.lena }] })).ok).toBe(false);
    expect(t.world.db.writes).toEqual([]);
  });

  it("a move for a lead that is not in the plan", async () => {
    const t = await setup();
    const r = await t.submit([{ leadId: L.lena, stageId: S.pnc }]);
    expect(r).toMatchObject({ ok: false, stale: true });
    expect(t.world.db.writes).toEqual([]);
  });

  it("a lead whose stage changed since the plan refuses the WHOLE apply, including leads earlier in the list", async () => {
    const t = await setup();
    t.world.db.rows("crm_lead").find((r) => r.id === L.margo)!.current_stage_id = S.loe; // someone moved her
    const r = await t.submit([AMARA, MARGO]);
    expect(r).toEqual({ ok: false, error: MSG.stale, stale: true });
    expect(t.world.db.writes).toEqual([]);
    expect(t.move).not.toHaveBeenCalled();
    expect(stageOf(t.world, L.amara)).toBe(S.followUp);
  });
});

describe("applyReconcileAction: bad targets and bad requests", () => {
  it("a target stage that no longer exists", async () => {
    const t = await setup();
    t.world.db.tables.crm_stage = t.world.db.rows("crm_stage").filter((s) => s.id !== S.pnc);
    const r = await t.submit([AMARA]);
    expect(r).toEqual({ ok: false, error: MSG.stageGone });
    expect(t.world.db.writes).toEqual([]);
  });

  it("a target stage that opens a matter", async () => {
    const t = await setup();
    const r = await t.submit([{ leadId: L.amara, stageId: S.signed }]);
    expect(r).toEqual({ ok: false, error: MSG.stageGone });
    expect(t.world.db.writes).toEqual([]);
    expect(t.move).not.toHaveBeenCalled();
  });

  it("a stage id the firm doesn't have at all", async () => {
    const t = await setup();
    const r = await t.submit([{ leadId: L.amara, stageId: "99999999-0000-4000-8000-000000000009" }]);
    expect(r).toEqual({ ok: false, error: MSG.stageGone });
  });

  it("refuses ids that are not UUIDs and shapes that are not requests", async () => {
    const t = await setup();
    const bad = [
      await t.submit([{ leadId: "not-a-uuid", stageId: S.pnc }]),
      await t.submit([{ leadId: L.amara, stageId: "nope" }]),
      await t.submit([AMARA, AMARA]),
      await t.applyReconcileAction(null),
      await t.applyReconcileAction("plan"),
      await t.applyReconcileAction({ plan: "x", fingerprint: 1, moves: [] }),
      await t.applyReconcileAction({ plan: [{ leadId: "nope" }], fingerprint: t.preview.fingerprint, moves: [AMARA] }),
      await t.applyReconcileAction({ plan: t.preview.plan.map((p) => ({ ...p, confidence: "maybe" })), fingerprint: t.preview.fingerprint, moves: [AMARA] }),
    ];
    for (const r of bad) expect(r).toEqual({ ok: false, error: MSG.badRequest });
    expect(t.world.db.writes).toEqual([]);
  });

  it("nothing chosen, and more than one pass allows", async () => {
    const t = await setup();
    expect(await t.submit([])).toEqual({ ok: false, error: MSG.nothingChosen });
    const many = Array.from({ length: MAX_MOVES_PER_APPLY + 1 }, (_, i) => ({ leadId: `77777777-0000-4000-8000-${String(i).padStart(12, "0")}`, stageId: S.pnc }));
    expect(await t.submit(many)).toEqual({ ok: false, error: MSG.tooMany });
    expect(MSG.tooMany).toContain(String(MAX_MOVES_PER_APPLY));
    expect(t.world.db.writes).toEqual([]);
  });

  it("applies exactly the cap in one pass", async () => {
    const leads = Array.from({ length: MAX_MOVES_PER_APPLY }, (_, i) => leadRow({ id: `88888888-0000-4000-8000-${String(i).padStart(12, "0")}`, current_stage_id: S.pnc }));
    const world = makeWorld({ leads });
    const loaded = await loadActions(world);
    const plan: PlanRow[] = leads.map((l) => ({ leadId: String(l.id), fromStageId: S.pnc, proposedStageId: S.loe, evidenceDate: null, confidence: "sheet_only" }));
    const r = await loaded.applyReconcileAction({ plan, fingerprint: planFingerprint(plan), moves: plan.map((p) => ({ leadId: p.leadId, stageId: S.loe })) });
    expect(r).toMatchObject({ ok: true, totals: { moved: MAX_MOVES_PER_APPLY, already: 0, failed: 0 } });
  });
});

describe("applyReconcileAction: another firm's lead is not found", () => {
  it("is never moved, and nothing else moves with it", async () => {
    const world = makeWorld({ leads: [...fixtureLeads(), foreignLead(L.other)] });
    const loaded = await loadActions(world);
    // A plan and fingerprint that are self-consistent, naming a lead RLS hides.
    const plan: PlanRow[] = [
      { leadId: L.amara, fromStageId: S.followUp, proposedStageId: S.pnc, evidenceDate: null, confidence: "sheet_only" },
      { leadId: L.other, fromStageId: S.pnc, proposedStageId: S.loe, evidenceDate: null, confidence: "agree" },
    ];
    const r = await loaded.applyReconcileAction({ plan, fingerprint: planFingerprint(plan), moves: [{ leadId: L.amara, stageId: S.pnc }, { leadId: L.other, stageId: S.loe }] });
    expect(r).toEqual({ ok: false, error: MSG.notFound });
    expect(MSG.notFound).toMatch(/not found/);
    expect(loaded.move).not.toHaveBeenCalled();
    expect(world.db.writes).toEqual([]);
    expect(world.db.rows("crm_lead").find((l) => l.id === L.other)!.current_stage_id).toBe(S.pnc);
    expect(world.db.rows("crm_lead").find((l) => l.org_id === OTHER_ORG)).toBeDefined();
  });
});

describe("applyReconcileAction: per-row results", () => {
  it("a failing row is reported and the next rows still run", async () => {
    const t = await setup();
    t.move.mockImplementationOnce(async () => {
      throw { code: "XX000", message: SECRET };
    });
    const r = await t.submit([AMARA, MARGO]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.outcomes).toEqual([
      { leadId: L.amara, status: "failed", error: MSG.moveFailed },
      { leadId: L.margo, status: "moved", stageName: "Consultation Scheduled" },
    ]);
    expect(r.totals).toEqual({ moved: 1, already: 0, failed: 1 });
    expect(stageOf(t.world, L.amara)).toBe(S.followUp);
    expect(stageOf(t.world, L.margo)).toBe(S.consult);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
  });

  it("a permission refusal from the move reads as one", async () => {
    const t = await setup();
    t.move.mockImplementationOnce(async () => {
      throw new Error("Forbidden: role clerk may not move lead stage");
    });
    const r = await t.submit([AMARA]);
    expect(r).toMatchObject({ ok: false, outcomes: [{ status: "failed", error: MSG.moveForbidden }] });
  });

  it("a lead already in the target stage is reported and not written", async () => {
    const t = await setup();
    // Priya is in Preliminary Search; the person picks that same stage.
    const r = await t.submit([{ leadId: L.priya, stageId: S.prelim }, AMARA]);
    expect(r).toMatchObject({ ok: true, totals: { moved: 1, already: 1, failed: 0 } });
    if (r.ok) expect(r.outcomes[0]).toEqual({ leadId: L.priya, status: "already", stageName: "Preliminary Search" });
    expect(t.move.mock.calls.map((c) => c[0])).toEqual([L.amara]);
  });

  it("the totals add up to the submitted count", async () => {
    const t = await setup();
    t.move.mockImplementationOnce(async () => {
      throw new Error("x");
    });
    const r = await t.submit([AMARA, MARGO, { leadId: L.priya, stageId: S.prelim }]);
    if (!r.ok) throw new Error("expected ok");
    expect(r.totals.moved + r.totals.already + r.totals.failed).toBe(3);
    expect(r.outcomes).toHaveLength(3);
  });

  it("a run where every row failed is not reported as success", async () => {
    const t = await setup();
    t.move.mockImplementation(async () => {
      throw new Error(SECRET);
    });
    const r = await t.submit([AMARA, MARGO]);
    expect(r).toMatchObject({ ok: false, error: MSG.allFailed });
    if (!r.ok) expect(r.outcomes).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(t.revalidated).toEqual([]);
  });
});

describe("applyReconcileAction: no raw database text reaches the screen", () => {
  it("a failed re-read of the leads", async () => {
    const t = await setup();
    t.world.db.fail("crm_lead", "select", { code: "23505", message: `duplicate key value violates unique constraint "${SECRET}"` });
    const r = await t.submit([AMARA]);
    expect(r).toEqual({ ok: false, error: MSG.readFailed });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
    expect(t.world.db.writes).toEqual([]);
  });

  it("a failed re-read of the stages", async () => {
    const t = await setup();
    t.world.db.fail("crm_stage", "select", { code: "XX000", message: SECRET });
    const r = await t.submit([AMARA]);
    expect(r).toEqual({ ok: false, error: MSG.readFailed });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it("a database error inside the move itself", async () => {
    const t = await setup();
    t.world.db.fail("crm_lead", "update", { code: "23505", message: `constraint crm_lead_pkey org ${SECRET}` });
    const r = await t.submit([AMARA]);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged()).not.toContain(SECRET);
    expect(stageOf(t.world, L.amara)).toBe(S.followUp);
  });
});

describe("applyReconcileAction: Lawmatics is never written", () => {
  it("apply makes no Lawmatics call at all", async () => {
    const t = await setup();
    t.clientFactory.mockClear();
    await t.submit([AMARA, MARGO]);
    expect(t.clientFactory).not.toHaveBeenCalled();
  });
});
