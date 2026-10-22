import { describe, expect, it } from "vitest";
import { MILESTONE_LABEL, opensMatter, stageForMilestone, type Milestone } from "../../src/lib/reconcile/milestones";
import { describeEvidence, formatDay, proposeStage } from "../../src/lib/reconcile/propose";
import { collapseEvidence, lastTouchOf, lawmaticsEvidence, mailEvidence, sheetNoteEvidence } from "../../src/lib/reconcile/evidence";
import type { EvidenceItem, EvidenceVia, ProposeSources, SourceName, StageOpt } from "../../src/lib/reconcile/types";
import type { SheetEntry } from "../../src/lib/intake/sheet-read";
import { NOW, S, STAGES, matter, none, stageSignal, unavailable } from "./helpers";

/** Milestone evidence against the firm's stages: the proposal rule of Sprint 26, with invented people. */

const OWN: StageOpt[] = [
  ...STAGES,
  { id: "own-proposal", name: "Proposal Sent", category: "open", orderIndex: 4.5 },
  { id: "own-fu", name: "Follow-Up Sent", category: "open", orderIndex: 4.6 },
];

function ev(source: SourceName, via: EvidenceVia, milestone: Milestone, date: string | null, stages: readonly StageOpt[] = STAGES): EvidenceItem {
  const stage = date ? stageForMilestone(milestone, stages) : null;
  return { source, via, milestone, label: MILESTONE_LABEL[milestone], date, stageId: stage?.id ?? null, ...(opensMatter(milestone) ? { matter: true } : {}) };
}

const quiet: ProposeSources = { sheet: none(), lawmatics: none(), email: none() };
const run = (extra: EvidenceItem[], over: Partial<ProposeSources> = {}, current: string | null = S.pnc, stages: readonly StageOpt[] = STAGES) =>
  proposeStage({ currentStageId: current }, { ...quiet, ...over }, stages, extra);
const text = (p: { reasons: string[] }) => p.reasons.join("\n");

describe("the most advanced dated evidence is proposed", () => {
  it("a note on the sheet can carry a lead past its status", () => {
    const p = run([ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")], { sheet: stageSignal(S.consult, "3. Consultation Scheduled", "2026-10-16T00:00:00.000Z") });
    expect(p.kind).toBe("stage");
    expect(p.stage?.id).toBe(S.post);
  });

  it("with no sheet at all, Lawmatics notes and mail propose on their own", () => {
    const p = run([ev("lawmatics", "note", "consult_scheduled", "2026-10-10T00:00:00.000Z"), ev("email", "mail", "proposal_sent", "2026-10-16T00:00:00.000Z")]);
    expect(p.stage?.id).toBe(S.post);
    // Lawmatics only got as far as the consult; the mail alone reaches the proposal.
    expect(p.confidence).toBe("single_source");
  });

  it("ties on a stage go to the newest evidence, and the evidence date is that newest one", () => {
    const p = run([ev("sheet", "note", "proposal_sent", "2026-10-14T00:00:00.000Z"), ev("lawmatics", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")]);
    expect(p.stage?.id).toBe(S.post);
    expect(p.evidenceDate).toBe("2026-10-16T00:00:00.000Z");
  });

  it("falls to the most advanced milestone the firm HAS a stage for, and still cites the rest", () => {
    // "opinion letter sent" outranks "consult scheduled", but this firm has no stage for it.
    const p = run([ev("sheet", "note", "opinion_letter_sent", "2026-10-12T00:00:00.000Z"), ev("sheet", "note", "consult_scheduled", "2026-10-10T00:00:00.000Z")]);
    expect(p.stage?.id).toBe(S.consult);
    expect(text(p)).toContain("Opinion letter sent Oct 12 (sheet note)");
  });

  it("a milestone the firm has no stage for gives no proposal, never the first stage", () => {
    const p = run([ev("sheet", "note", "opinion_letter_sent", "2026-10-12T00:00:00.000Z")]);
    expect(p.kind).toBe("no_proposal");
    expect(p.stage).toBeNull();
    expect(p.confidence).toBe("no_evidence");
    expect(text(p)).toContain("Opinion letter sent Oct 12");
    expect(text(p)).toContain("none of this evidence names a stage this firm has");
  });

  it("evidence without a date is cited and never acted on", () => {
    const p = run([ev("sheet", "note", "proposal_sent", null)]);
    expect(p.kind).toBe("no_proposal");
    expect(text(p)).toContain("Proposal sent (sheet note)");
  });

  it("a firm with its own Proposal Sent and Follow-Up Sent stages gets the furthest of them", () => {
    const p = run(
      [ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z", OWN), ev("email", "mail", "follow_up_sent", "2026-10-18T00:00:00.000Z", OWN)],
      {},
      S.pnc,
      OWN,
    );
    expect(p.stage?.id).toBe("own-fu");
  });
});

describe("the proposal names every piece of evidence with its source and date", () => {
  it("reads like 'Proposal sent Oct 16 (sheet note) · Follow-up sent Oct 18 (email) · ...'", () => {
    const p = run([
      ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z"),
      ev("email", "mail", "follow_up_sent", "2026-10-18T00:00:00.000Z"),
      ev("lawmatics", "note", "proposal_sent", "2026-10-16T00:00:00.000Z"),
    ]);
    const line = p.reasons.find((r) => r.startsWith("Evidence:"))!;
    expect(line).toBe("Evidence: Follow-up sent Oct 18 (email) · Proposal sent Oct 16 (sheet note) · Proposal sent Oct 16 (Lawmatics note).");
    expect(p.evidence).toHaveLength(3);
  });

  it("describeEvidence and formatDay: month and day, the year only when it differs", () => {
    expect(formatDay("2026-10-16T09:00:00Z")).toBe("Oct 16");
    expect(formatDay("2025-12-02T00:00:00Z", 2026)).toBe("Dec 2, 2025");
    expect(formatDay("2026-10-16T00:00:00Z", 2026)).toBe("Oct 16");
    expect(formatDay(null)).toBeNull();
    expect(describeEvidence(ev("email", "mailbox", "follow_up_sent", "2026-10-18T00:00:00Z"))).toBe("Follow-up sent Oct 18 (mailbox search)");
  });
});

describe("agree, conflict and one source", () => {
  it("agree: two sources each reach the proposed stage", () => {
    const p = run([ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z"), ev("lawmatics", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")]);
    expect(p.confidence).toBe("agree");
  });

  it("conflict: a status code older than the notes (a source pointing backward), still proposing the most advanced evidenced stage", () => {
    const p = run([ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")], { sheet: stageSignal(S.pnc, "1. Potential New Client", "2026-10-12T00:00:00.000Z") }, S.followUp);
    expect(p.kind).toBe("stage");
    expect(p.stage?.id).toBe(S.post);
    expect(p.confidence).toBe("conflict");
    expect(text(p)).toContain("A source points elsewhere");
  });

  it("conflict: a Lawmatics stage that is behind the sheet's notes", () => {
    const p = run([ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")], { lawmatics: stageSignal(S.consult, "Consultation Scheduled") });
    expect(p.confidence).toBe("conflict");
  });

  it("an earlier note in the same journey is history, not a conflict", () => {
    const p = run([ev("sheet", "note", "consult_scheduled", "2026-10-10T00:00:00.000Z"), ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")]);
    expect(p.confidence).toBe("sheet_only");
  });

  it("one non-sheet source is single_source", () => {
    expect(run([ev("lawmatics", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")]).confidence).toBe("single_source");
    expect(run([ev("email", "mail", "proposal_sent", "2026-10-16T00:00:00.000Z")]).confidence).toBe("single_source");
  });

  it("no evidence at all is no_evidence, with nothing proposed", () => {
    const p = run([]);
    expect(p).toMatchObject({ kind: "no_proposal", stage: null, confidence: "no_evidence", evidenceDate: null });
    expect(text(p)).toContain("none of the sources names a stage");
  });
});

describe("never backwards from the lead's current stage", () => {
  it("evidence before the current stage proposes nothing, and says why", () => {
    const p = run([ev("sheet", "note", "consult_scheduled", "2026-10-10T00:00:00.000Z")], {}, S.loe);
    expect(p.kind).toBe("no_proposal");
    expect(p.stage).toBeNull();
    expect(text(p)).toContain("never moved backwards");
    expect(text(p)).toContain("Consultation Scheduled");
  });

  it("evidence at the current stage is 'Already in this stage'", () => {
    const p = run([ev("sheet", "note", "consult_scheduled", "2026-10-10T00:00:00.000Z")], {}, S.consult);
    expect(p.reasons[0]).toBe("Already in this stage.");
  });

  it("a lead in a nurture stage (order 0) can move forward", () => {
    expect(run([ev("sheet", "note", "consult_scheduled", "2026-10-10T00:00:00.000Z")], {}, S.followUp).stage?.id).toBe(S.consult);
  });
});

describe("hired, paid and accepted never propose a won stage", () => {
  it.each(["hired", "paid", "accepted"] as const)("%s is needs_matter with no stage", (m) => {
    const p = run([ev("sheet", "note", "proposal_sent", "2026-10-14T00:00:00.000Z"), ev("sheet", "note", m, "2026-10-20T00:00:00.000Z")]);
    expect(p.kind).toBe("needs_matter");
    expect(p.stage).toBeNull();
    expect(p.confidence).toBeNull();
    expect(text(p)).toContain("open a matter");
  });

  it("whichever source says it", () => {
    for (const source of ["sheet", "lawmatics", "email"] as const) {
      expect(run([ev(source, "note", "paid", "2026-10-20T00:00:00.000Z")]).kind).toBe("needs_matter");
    }
  });

  it("an undated 'paid' is cited and does not ask for a matter", () => {
    expect(run([ev("sheet", "note", "paid", null), ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")]).kind).toBe("stage");
  });

  it("LOE sent on top of accepted is a stage (LOE & Invoice Sent), not a matter", () => {
    const p = run([ev("sheet", "note", "accepted", "2026-10-17T00:00:00.000Z"), ev("sheet", "note", "loe_sent", "2026-10-18T00:00:00.000Z")]);
    expect(p.kind).toBe("stage");
    expect(p.stage?.id).toBe(S.loe);
  });

  it("a sheet client code and Lawmatics Hired still ask for a matter", () => {
    expect(run([], { sheet: matter("7. Signed LOE / Deposit Received") }).kind).toBe("needs_matter");
    expect(run([], { lawmatics: matter("Hired Client") }).kind).toBe("needs_matter");
  });

  it("no proposal of any kind is ever a won stage", () => {
    const won = new Set(STAGES.filter((s) => s.category === "won").map((s) => s.id));
    for (const m of ["contacted", "consult_scheduled", "proposal_sent", "loe_sent", "accepted", "paid", "hired", "declined", "nurture"] as Milestone[]) {
      const p = run([ev("sheet", "note", m, "2026-10-20T00:00:00.000Z")], {}, S.followUp);
      if (p.stage) expect(won.has(p.stage.id)).toBe(false);
    }
  });
});

describe("declined and nurture are proposed only from an explicit note", () => {
  it("an explicit decline that is newer than all progress is proposed (Lost)", () => {
    const p = run([ev("sheet", "note", "proposal_sent", "2026-10-14T00:00:00.000Z"), ev("sheet", "note", "declined", "2026-10-20T00:00:00.000Z")], {}, S.consult);
    expect(p.kind).toBe("stage");
    expect(p.stage?.id).toBe(S.lost);
  });

  it("an older decline is overtaken by later progress", () => {
    const p = run([ev("sheet", "note", "declined", "2026-10-02T00:00:00.000Z"), ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")]);
    expect(p.stage?.id).toBe(S.post);
  });

  it("a nurture note parks the lead in the nurture stage", () => {
    const p = run([ev("sheet", "note", "nurture", "2026-10-20T00:00:00.000Z")], {}, S.consult);
    expect(p.stage?.id).toBe(S.followUp);
  });

  it("silence never proposes either: no note, no decline", () => {
    const p = run([ev("sheet", "note", "proposal_sent", "2026-01-02T00:00:00.000Z")], {}, S.pnc);
    expect(p.stage?.id).not.toBe(S.lost);
    expect(p.stage?.id).not.toBe(S.followUp);
  });

  it("an undated decline is not acted on", () => {
    const p = run([ev("sheet", "note", "declined", null), ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")]);
    expect(p.stage?.id).toBe(S.post);
  });

  it("a no-show is cited and proposes nothing by itself", () => {
    const p = run([ev("sheet", "note", "no_show", "2026-10-20T00:00:00.000Z")]);
    expect(p.kind).toBe("no_proposal");
    expect(text(p)).toContain("No-show Oct 20 (sheet note)");
  });
});

describe("a source that is unavailable is named, never treated as none", () => {
  it("names it in the reasons and in unavailable, and the others still propose", () => {
    const p = run([ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z")], { lawmatics: unavailable("Lawmatics is not connected"), email: unavailable("mail read failed") });
    expect(p.unavailable).toEqual(["lawmatics", "email"]);
    expect(text(p)).toContain("Lawmatics was unavailable: Lawmatics is not connected");
    expect(text(p)).toContain("Email / calendar was unavailable: mail read failed");
    expect(p.stage?.id).toBe(S.post);
  });

  it("everything unavailable and nothing else is no_evidence listing all three", () => {
    const p = run([], { sheet: unavailable("a"), lawmatics: unavailable("b"), email: unavailable("c") });
    expect(p.confidence).toBe("no_evidence");
    expect(p.unavailable).toEqual(["sheet", "lawmatics", "email"]);
  });
});

describe("turning sources into evidence items", () => {
  const entry = (notes: SheetEntry["notes"]): SheetEntry => ({
    row: 5, ownerName: "Ottoline Marchbanks", markText: null, exactKey: "k", anyCodeKeys: [], reading: { kind: "ok", stageId: S.pnc, stageName: "Potential New Client", wording: "1.", date: null }, notes,
  });
  const ctx = { stages: STAGES, mapping: {}, now: NOW };

  it("sheet notes become dated milestones; a future date is not evidence of when", () => {
    const items = sheetNoteEvidence(entry([{ date: "2026-09-03", milestones: ["consult_scheduled"], snippet: "s" }, { date: "2030-01-01", milestones: ["proposal_sent"], snippet: "typo" }]), ctx);
    expect(items.map((i) => [i.milestone, i.date, i.stageId])).toEqual([
      ["consult_scheduled", "2026-09-03T00:00:00.000Z", S.consult],
      ["proposal_sent", null, null],
    ]);
    expect(items[0].snippet).toBe("s");
  });

  it("Lawmatics: an unmapped stage name states its own milestone; a mapped one is left to the signal", () => {
    const record = { lawmaticsId: "1", stageName: "Proposal Sent", updatedAt: "2026-09-10T00:00:00Z" } as never;
    expect(lawmaticsEvidence(record, undefined, true, ctx).map((i) => i.milestone)).toEqual(["proposal_sent"]);
    expect(lawmaticsEvidence(record, undefined, false, ctx)).toEqual([]);
  });

  it("Lawmatics notes count only when they were read (an unavailable read adds nothing, and is not 'none')", () => {
    const record = { lawmaticsId: "1", stageName: "x", updatedAt: null } as never;
    expect(lawmaticsEvidence(record, { status: "unavailable", reason: "r" }, false, ctx)).toEqual([]);
    const ok = lawmaticsEvidence(record, { status: "ok", truncated: false, notes: [{ date: "2026-09-03T00:00:00Z", milestones: ["consult_held"], snippet: "n" }] }, false, ctx);
    expect(ok.map((i) => i.milestone)).toEqual(["consult_held"]);
  });

  it("mail: a sensitive thread contributes nothing; direction decides what a message is", () => {
    const items = mailEvidence(
      [
        { type: "other", sensitive: true, at: "2026-09-03T00:00:00Z", direction: "sent", subject: "Settlement" },
        { type: "other", sensitive: false, at: "2026-09-04T00:00:00Z", direction: "sent", subject: "Your Trademark Proposal" },
        { type: "other", sensitive: false, at: "2026-09-05T00:00:00Z", direction: "received", subject: "Your Trademark Proposal" },
      ],
      [],
      ctx,
    );
    expect(items.map((i) => i.milestone)).toEqual(["proposal_sent", "contacted"]);
  });

  it("collapse keeps the newest per source, way of reading and milestone", () => {
    const out = collapseEvidence([ev("email", "mail", "contacted", "2026-09-01T00:00:00Z"), ev("email", "mail", "contacted", "2026-09-09T00:00:00Z"), ev("email", "mail", "contacted", null)]);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe("2026-09-09T00:00:00Z");
  });
});

describe("the proposed last touch", () => {
  const items = [ev("sheet", "note", "proposal_sent", "2026-09-10T00:00:00Z"), ev("email", "mail", "follow_up_sent", "2026-09-12T00:00:00Z")];

  it("is the newest dated fact across the sources", () => {
    expect(lastTouchOf(items, ["2026-09-01T00:00:00Z"], NOW)).toBe("2026-09-12T00:00:00.000Z");
  });

  it("counts the touches that are not milestones (every synced mail, the sheet's newest log date)", () => {
    expect(lastTouchOf(items, ["2026-09-13T08:00:00Z"], NOW)).toBe("2026-09-13T08:00:00.000Z");
  });

  it("never lands in the future", () => {
    expect(lastTouchOf(items, ["2030-01-01T00:00:00Z", "2026-09-20T00:00:00Z"], NOW)).toBe("2026-09-12T00:00:00.000Z");
  });

  it("is null when there is nothing dated", () => {
    expect(lastTouchOf([ev("sheet", "note", "proposal_sent", null)], [null, undefined], NOW)).toBeNull();
    expect(lastTouchOf([], [], NOW)).toBeNull();
  });
});

describe("the function is pure", () => {
  it("the same input gives the same proposal, and does not change its input", () => {
    const input = [ev("sheet", "note", "proposal_sent", "2026-10-16T00:00:00.000Z"), ev("email", "mail", "follow_up_sent", "2026-10-18T00:00:00.000Z")];
    const copy = JSON.stringify(input);
    expect(run(input)).toEqual(run(input));
    expect(JSON.stringify(input)).toBe(copy);
  });
});
