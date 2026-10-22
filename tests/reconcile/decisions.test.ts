import { describe, expect, it } from "vitest";
import { accept, acceptAgreeing, acceptedCount, agreeingCount, canAccept, movesFrom, pick, skip } from "../../src/lib/reconcile/decisions";
import { canonicalPlan, planFingerprint } from "../../src/lib/reconcile/fingerprint";
import { proposeStage } from "../../src/lib/reconcile/propose";
import type { Decisions, PlanRow, ProposeSources, ReconcileRow } from "../../src/lib/reconcile/types";
import { S, STAGES, matter, none, planRow, stageName, stageSignal, unavailable, unmapped } from "./helpers";

let n = 0;
function row(sources: Partial<ProposeSources>, current = S.pnc): ReconcileRow {
  const all = { sheet: none(), lawmatics: none(), email: none(), ...sources };
  n += 1;
  return {
    leadId: `66666666-0000-4000-8000-${String(n).padStart(12, "0")}`,
    leadName: `Lead ${n}`,
    currentStageId: current,
    currentStageName: stageName(current),
    ...all,
    proposal: proposeStage({ currentStageId: current }, all, STAGES),
  };
}

const date = "2026-09-03T00:00:00.000Z";
const agree = () => row({ sheet: stageSignal(S.consult, "3.", date), lawmatics: stageSignal(S.consult) });
const sheetOnly = () => row({ sheet: stageSignal(S.consult, "3.", date) });
const conflict = () => row({ sheet: stageSignal(S.consult), lawmatics: stageSignal(S.post) });
// A source that names no stage this firm has proposes nothing (a Lawmatics stage alone now would).
const noEvidence = () => row({ lawmatics: unmapped("Discovery Call No Show") });
const needsMatter = () => row({ sheet: stageSignal(S.consult), lawmatics: matter("Hired") });
const alreadyThere = () => row({ sheet: stageSignal(S.pnc), lawmatics: stageSignal(S.pnc) });
const unavailableRow = () => row({ sheet: stageSignal(S.consult), lawmatics: unavailable("down"), email: unavailable("down") });

describe("accept", () => {
  it("records the proposal and its evidence date", () => {
    const r = agree();
    expect(accept({}, r)).toEqual({ [r.leadId]: { stageId: S.consult, evidenceDate: date, picked: false } });
  });
  it("does nothing for a row that proposes no stage", () => {
    for (const r of [noEvidence(), needsMatter(), alreadyThere()]) {
      expect(canAccept(r)).toBe(false);
      expect(accept({}, r)).toEqual({});
    }
  });
});

describe("pick another", () => {
  const pickable = STAGES.filter((s) => s.category !== "won");
  it("replaces the target and clears the evidence date", () => {
    const r = agree();
    const accepted = accept({}, r);
    const picked = pick(accepted, r.leadId, S.loe, pickable);
    expect(picked[r.leadId]).toEqual({ stageId: S.loe, evidenceDate: null, picked: true });
    expect(accepted[r.leadId].evidenceDate).toBe(date); // the input is not mutated
  });
  it("works on a row that had no proposal", () => {
    const r = noEvidence();
    expect(pick({}, r.leadId, S.undecided, pickable)[r.leadId]).toMatchObject({ stageId: S.undecided, picked: true });
  });
  it("refuses a stage that opens a matter, or one the firm doesn't have", () => {
    const r = agree();
    expect(pick({}, r.leadId, S.signed, pickable)).toEqual({});
    expect(pick({}, r.leadId, "not-a-stage", pickable)).toEqual({});
  });
});

describe("skip", () => {
  it("removes the row from the apply set", () => {
    const r = agree();
    const d = accept({}, r);
    expect(skip(d, r.leadId)).toEqual({});
    expect(d[r.leadId]).toBeDefined();
  });
  it("is harmless on a row that was never decided", () => {
    const d: Decisions = {};
    expect(skip(d, "x")).toBe(d);
  });
});

describe("accept all where two or more sources agree", () => {
  it("marks exactly the agree rows and returns the count", () => {
    const rows = [agree(), sheetOnly(), conflict(), noEvidence(), needsMatter(), alreadyThere(), unavailableRow(), agree()];
    expect(agreeingCount(rows)).toBe(2);
    const { decisions, marked } = acceptAgreeing({}, rows);
    expect(marked).toBe(2);
    expect(Object.keys(decisions).sort()).toEqual([rows[0].leadId, rows[7].leadId].sort());
    for (const r of rows.slice(1, 7)) expect(decisions[r.leadId]).toBeUndefined();
  });

  it("marks nothing when no row agrees", () => {
    const { decisions, marked } = acceptAgreeing({}, [sheetOnly(), conflict(), unavailableRow()]);
    expect(marked).toBe(0);
    expect(decisions).toEqual({});
  });

  it("leaves a row the person already decided as they set it", () => {
    const r = agree();
    const picked = pick({}, r.leadId, S.loe, STAGES.filter((s) => s.category !== "won"));
    const { decisions, marked } = acceptAgreeing(picked, [r]);
    expect(marked).toBe(0);
    expect(decisions[r.leadId].stageId).toBe(S.loe);
  });
});

describe("the apply set", () => {
  it("counts accepted rows and lists them as moves without any date", () => {
    const a = agree();
    const b = sheetOnly();
    let d = accept({}, a);
    d = accept(d, b);
    d = skip(d, b.leadId);
    expect(acceptedCount(d)).toBe(1);
    expect(movesFrom(d)).toEqual([{ leadId: a.leadId, stageId: S.consult }]);
    expect(acceptedCount({})).toBe(0);
  });
});

describe("the plan fingerprint", () => {
  const a = planRow({ leadId: "66666666-0000-4000-8000-00000000000a" });
  const b = planRow({ leadId: "66666666-0000-4000-8000-00000000000b", proposedStageId: null, evidenceDate: null, confidence: null });
  const c = planRow({ leadId: "66666666-0000-4000-8000-00000000000c", confidence: "agree" });

  it("is a SHA-256 hex digest", () => {
    expect(planFingerprint([a, b, c])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same for the same plan in any row order", () => {
    const base = planFingerprint([a, b, c]);
    expect(planFingerprint([c, b, a])).toBe(base);
    expect(planFingerprint([b, a, c])).toBe(base);
  });

  it("is the same whatever order the keys were written in", () => {
    const shuffled: PlanRow = { confidence: a.confidence, evidenceDate: a.evidenceDate, proposedStageId: a.proposedStageId, fromStageId: a.fromStageId, leadId: a.leadId };
    expect(planFingerprint([shuffled, b, c])).toBe(planFingerprint([a, b, c]));
  });

  it("changes when any single field of any row changes", () => {
    const base = planFingerprint([a, b, c]);
    const changes: Array<Partial<PlanRow>> = [
      { leadId: "66666666-0000-4000-8000-0000000000aa" },
      { fromStageId: S.prelim },
      { proposedStageId: S.loe },
      { proposedStageId: null },
      { evidenceDate: "2026-09-04T00:00:00.000Z" },
      { evidenceDate: null },
      { confidence: "conflict" },
      { confidence: null },
    ];
    for (const change of changes) {
      expect(planFingerprint([{ ...a, ...change }, b, c])).not.toBe(base);
      if (!("leadId" in change)) expect(planFingerprint([a, b, { ...c, ...change }])).not.toBe(base);
    }
    expect(planFingerprint([a, b])).not.toBe(base); // a dropped row
    expect(planFingerprint([a, b, c, planRow({ leadId: "66666666-0000-4000-8000-0000000000dd" })])).not.toBe(base); // an added row
  });

  it("writes a missing value as null so absent and null agree", () => {
    expect(canonicalPlan([b])).toContain("null");
    expect(planFingerprint([{ ...b, evidenceDate: undefined as unknown as null }])).toBe(planFingerprint([b]));
  });
});
