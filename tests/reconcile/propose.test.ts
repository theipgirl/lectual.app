import { describe, expect, it } from "vitest";
import { isAlreadyThere, proposeStage } from "../../src/lib/reconcile/propose";
import type { ProposeSources, SourceSignal } from "../../src/lib/reconcile/types";
import { S, STAGES, matter, none, stageName, stageSignal, unavailable, unmapped } from "./helpers";

const CURRENT = S.pnc;
const run = (sources: Partial<ProposeSources>, current: string | null = CURRENT) =>
  proposeStage(
    { currentStageId: current },
    { sheet: none(), lawmatics: none(), email: none(), ...sources },
    STAGES,
  );
const text = (p: { reasons: string[] }) => p.reasons.join("\n");

describe("proposeStage: agree", () => {
  it("sheet and Lawmatics on the same stage", () => {
    const p = run({ sheet: stageSignal(S.consult, "3. Consultation Scheduled", "2026-09-03T00:00:00.000Z"), lawmatics: stageSignal(S.consult, "Consultation Scheduled") });
    expect(p.kind).toBe("stage");
    expect(p.stage).toEqual({ id: S.consult, name: "Consultation Scheduled" });
    expect(p.confidence).toBe("agree");
    expect(text(p)).toContain("Consultation Scheduled (Lawmatics stage)");
    expect(text(p)).toContain("3. Consultation Scheduled Sep 3 (sheet status)");
    expect(p.evidenceDate).toBe("2026-09-03T00:00:00.000Z");
  });

  it("sheet and email on the same stage", () => {
    const p = run({ sheet: stageSignal(S.loe), email: stageSignal(S.loe, "LOE and invoice email") });
    expect(p.confidence).toBe("agree");
    expect(text(p)).toContain("LOE and invoice email (email)");
  });

  it("sheet, Lawmatics and email all on the same stage", () => {
    const p = run({ sheet: stageSignal(S.post), lawmatics: stageSignal(S.post), email: stageSignal(S.post) });
    expect(p.confidence).toBe("agree");
    const evidence = p.reasons.find((r) => r.startsWith("Evidence:"))!;
    expect(evidence.split(" · ")).toHaveLength(3);
  });
});

describe("proposeStage: sheet_only", () => {
  const sheet = stageSignal(S.consult);
  it.each([
    ["Lawmatics none", { lawmatics: none() }],
    ["Lawmatics unmapped", { lawmatics: unmapped("Discovery Call No Show") }],
    ["Lawmatics unavailable", { lawmatics: unavailable("not connected") }],
    ["email none", { email: none() }],
    ["email unavailable", { email: unavailable("mail read failed") }],
    ["email unmapped", { email: unmapped("Post-consultation email") }],
  ] as Array<[string, Partial<ProposeSources>]>)("%s", (_label, extra) => {
    const p = run({ sheet, ...extra });
    expect(p.kind).toBe("stage");
    expect(p.confidence).toBe("sheet_only");
    expect(p.stage?.id).toBe(S.consult);
  });

  it("names each non-voting source by its own state in the reasons", () => {
    const p = run({ sheet, lawmatics: unavailable("not connected"), email: none("mail found, but none of it names a stage") });
    expect(text(p)).toContain("Lawmatics was unavailable: not connected");
    expect(text(p)).toContain("Email / calendar has no stage for this lead (mail found, but none of it names a stage)");
    const q = run({ sheet, lawmatics: unmapped("Discovery Call No Show") });
    expect(text(q)).toContain('Lawmatics: "Discovery Call No Show" doesn\'t match any of this firm\'s stages');
  });
});

describe("proposeStage: conflict", () => {
  it("the furthest evidenced stage wins over an older sheet status, and both are named", () => {
    const p = run({ sheet: stageSignal(S.consult, "3. Consultation Scheduled"), lawmatics: stageSignal(S.post, "Post Consultation") });
    expect(p.confidence).toBe("conflict");
    expect(p.stage?.id).toBe(S.post);
    expect(text(p)).toContain("Sheet:");
    expect(text(p)).toContain("Lawmatics:");
    expect(text(p)).toContain("A source points elsewhere");
  });

  it("sheet X + Lawmatics X + email Y is a conflict, not agree, and Y (the furthest) is proposed", () => {
    const p = run({ sheet: stageSignal(S.consult), lawmatics: stageSignal(S.consult), email: stageSignal(S.loe) });
    expect(p.confidence).toBe("conflict");
    expect(p.stage?.id).toBe(S.loe);
    expect(text(p)).toContain("A source points elsewhere");
  });
});

describe("proposeStage: no_evidence", () => {
  it("a lead with no sheet row is proposed from Lawmatics and email when they agree (the sheet no longer has to speak)", () => {
    const p = run({ sheet: none(), lawmatics: stageSignal(S.loe), email: stageSignal(S.loe) });
    expect(p.kind).toBe("stage");
    expect(p.stage?.id).toBe(S.loe);
    expect(p.confidence).toBe("agree");
    expect(text(p)).toContain("The sheet has no row for this lead");
  });

  it("an unmapped sheet row does not vote; another source can still propose, as one source", () => {
    const p = run({ sheet: unmapped("2. Petting Zoo Review"), lawmatics: stageSignal(S.consult) });
    expect(p.kind).toBe("stage");
    expect(p.confidence).toBe("single_source");
    expect(text(p)).toContain("2. Petting Zoo Review");
  });

  it("an unmapped sheet row with nothing else is no_evidence", () => {
    const p = run({ sheet: unmapped("2. Petting Zoo Review") });
    expect(p.confidence).toBe("no_evidence");
    expect(p.stage).toBeNull();
    expect(text(p)).toContain("2. Petting Zoo Review");
  });

  it("unmapped Lawmatics alone is no_evidence with the Lawmatics name in the reasons", () => {
    const p = run({ lawmatics: unmapped("Discovery Call No Show") });
    expect(p.kind).toBe("no_proposal");
    expect(p.confidence).toBe("no_evidence");
    expect(text(p)).toContain("Discovery Call No Show");
  });

  it("carries the ambiguity note when the sheet row matched more than one lead", () => {
    const p = run({ sheet: none("2 leads share this sheet key") });
    expect(text(p)).toContain("2 leads share this sheet key");
  });
});

describe("proposeStage: needs_matter", () => {
  it.each(["Hired", "Hired Client", "HIRED CLIENT", "hired-client", "  Hired  "])('Lawmatics "%s" is needs_matter with no stage', (wording) => {
    const p = run({ sheet: stageSignal(S.consult), lawmatics: matter(wording) });
    expect(p.kind).toBe("needs_matter");
    expect(p.stage).toBeNull();
    expect(p.confidence).toBeNull();
    expect(text(p)).toContain(wording);
  });

  it("a sheet client code is needs_matter", () => {
    const p = run({ sheet: matter("7. Signed LOE / Deposit Received") });
    expect(p.kind).toBe("needs_matter");
    expect(p.stage).toBeNull();
    expect(text(p)).toContain("means this person is a client");
  });

  it("sheet X + Lawmatics Hired lists both and still proposes no stage", () => {
    const p = run({ sheet: stageSignal(S.consult, "3. Consultation Scheduled"), lawmatics: matter("Hired Client") });
    expect(p.kind).toBe("needs_matter");
    expect(text(p)).toContain("3. Consultation Scheduled");
    expect(text(p)).toContain("Hired Client");
  });

  it('a non-Hired unmapped Lawmatics stage such as "Discovery Call No Show" is not needs_matter', () => {
    const p = run({ sheet: stageSignal(S.consult), lawmatics: unmapped("Discovery Call No Show") });
    expect(p.kind).toBe("stage");
  });

  it("an email signal never asks for a matter", () => {
    const p = run({ sheet: stageSignal(S.consult), email: matter("anything") });
    expect(p.kind).toBe("stage");
  });
});

describe("proposeStage: a source that is unavailable", () => {
  it.each(["sheet", "lawmatics", "email"] as const)("%s unavailable alone is named, never read as none", (name) => {
    const sources: Partial<ProposeSources> = { sheet: stageSignal(S.consult), [name]: unavailable("down for maintenance") };
    const p = run(sources);
    expect(p.unavailable).toEqual([name]);
    expect(text(p)).toContain("was unavailable: down for maintenance");
    expect(text(p)).not.toMatch(/has no stage for this lead.*down for maintenance/);
  });

  it("Lawmatics unavailable plus a sheet stage is sheet_only with the source listed", () => {
    const p = run({ sheet: stageSignal(S.consult), lawmatics: unavailable("not connected") });
    expect(p.confidence).toBe("sheet_only");
    expect(p.unavailable).toEqual(["lawmatics"]);
  });

  it("all of Lawmatics and email unavailable with a sheet stage is still sheet_only", () => {
    const p = run({ sheet: stageSignal(S.consult), lawmatics: unavailable("a"), email: unavailable("b") });
    expect(p.kind).toBe("stage");
    expect(p.confidence).toBe("sheet_only");
    expect(p.unavailable).toEqual(["lawmatics", "email"]);
  });

  it("no sheet and everything unavailable is no_evidence listing three sources", () => {
    const p = run({ sheet: unavailable("x"), lawmatics: unavailable("y"), email: unavailable("z") });
    expect(p.confidence).toBe("no_evidence");
    expect(p.unavailable).toEqual(["sheet", "lawmatics", "email"]);
    expect(text(p)).toContain("Sheet was unavailable: x");
    expect(text(p)).toContain("Lawmatics was unavailable: y");
    expect(text(p)).toContain("Email / calendar was unavailable: z");
  });
});

describe("proposeStage: no change and no won stage", () => {
  it("a sheet stage equal to the current stage proposes nothing", () => {
    const p = run({ sheet: stageSignal(S.pnc), lawmatics: stageSignal(S.pnc) });
    expect(p.kind).toBe("no_proposal");
    expect(p.stage).toBeNull();
    expect(p.reasons[0]).toBe("Already in this stage.");
    expect(isAlreadyThere(p)).toBe(true);
  });

  it("a sheet stage that resolves to a won stage is never proposed", () => {
    const p = run({ sheet: stageSignal(S.signed, "6. Signed"), lawmatics: stageSignal(S.signed) });
    expect(p.kind).toBe("no_proposal");
    expect(p.stage).toBeNull();
    expect(p.confidence).toBe("no_evidence");
    expect(text(p)).toContain("opens a matter");
    expect(isAlreadyThere(p)).toBe(false);
  });

  it("a sheet stage the firm does not have is never proposed", () => {
    const p = run({ sheet: { kind: "stage", stageId: "00000000-0000-4000-8000-00000000dead", stageName: "Ghost", wording: "9. Ghost", date: null } });
    expect(p.stage).toBeNull();
    expect(text(p)).toContain("none of this evidence names a stage this firm has");
  });

  it("a lead with no current stage still gets a proposal", () => {
    expect(run({ sheet: stageSignal(S.consult) }, null).stage?.id).toBe(S.consult);
  });
});

describe("proposeStage: property over a grid of source combinations", () => {
  const options: SourceSignal[] = [
    none(),
    none("note"),
    unavailable(),
    unmapped("Whatever"),
    matter("Hired"),
    ...STAGES.map((s) => stageSignal(s.id)),
  ];
  it("a proposed stage is always one of the firm's non-won stages, and the function is pure", () => {
    const ids = new Set(STAGES.filter((s) => s.category !== "won").map((s) => s.id));
    let checked = 0;
    for (const sheet of options) {
      for (const lawmatics of options) {
        for (const email of options) {
          for (const current of [S.pnc, S.consult, null]) {
            const sources = { sheet, lawmatics, email };
            const first = proposeStage({ currentStageId: current }, sources, STAGES);
            const again = proposeStage({ currentStageId: current }, sources, STAGES);
            expect(again).toEqual(first);
            if (first.stage) {
              expect(ids.has(first.stage.id)).toBe(true);
              expect(first.stage.name).toBe(stageName(first.stage.id));
              expect(first.kind).toBe("stage");
              expect(first.stage.id).not.toBe(current);
              // Some source named it, and a lead is never moved backwards.
              expect([sheet, lawmatics, email].some((x) => x.kind === "stage")).toBe(true);
              const order = (id: string | null) => STAGES.find((x) => x.id === id)?.orderIndex ?? -1;
              expect(order(first.stage.id)).toBeGreaterThanOrEqual(order(current));
            } else {
              expect(first.kind).not.toBe("stage");
            }
            if (first.kind === "needs_matter") expect(first.confidence).toBeNull();
            if (first.kind === "stage") expect(first.confidence).not.toBe("no_evidence");
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(options.length ** 3 * 3);
  });
});
