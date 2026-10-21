import {
  SOURCE_LABEL,
  type Confidence,
  type Proposal,
  type ProposeSources,
  type SourceName,
  type SourceSignal,
  type StageOpt,
} from "./types";

/**
 * Which stage should a lead be in? A pure function over what the three sources say.
 *
 * The rules, in order:
 *  1. A "needs a matter" signal from the sheet (a client status code) or from Lawmatics ("Hired")
 *     gives `needs_matter` and NO stage. Such a person is a client; moving them is not this
 *     screen's job, and it never guesses where they belong.
 *  2. Without a usable sheet stage there is no proposal (`no_evidence`). Lawmatics and email are
 *     corroboration: no source other than the sheet may propose a move on its own.
 *  3. A sheet stage that is not one of the firm's stages, or is a stage that opens a matter
 *     (category "won"), is never proposed. Moving a lead there runs the matter handoff.
 *  4. A sheet stage equal to the lead's current stage proposes nothing ("Already in this stage").
 *  5. Otherwise the sheet's stage is proposed. `agree` when another source named the same stage
 *     and none named a different one, `conflict` when any source named a different one (the sheet
 *     still wins), `sheet_only` when no other source voted.
 *
 * A source that is unavailable, said nothing, or named a stage the firm does not have never votes,
 * and an unavailable source is named in the reasons and in `unavailable`: it is not "no stage".
 */

const ORDER: readonly SourceName[] = ["sheet", "lawmatics", "email"];

function describeSignal(name: SourceName, signal: SourceSignal): string {
  const label = SOURCE_LABEL[name];
  switch (signal.kind) {
    case "unavailable":
      return `${label} was unavailable: ${signal.reason}`;
    case "none":
      return name === "sheet"
        ? `The sheet has no row for this lead${signal.note ? ` (${signal.note})` : ""}.`
        : `${label} has no stage for this lead${signal.note ? ` (${signal.note})` : ""}.`;
    case "unmapped":
      return `${label}: "${signal.wording}" doesn't match any of this firm's stages, so it doesn't count.`;
    case "needs_matter":
      return `${label}: "${signal.wording}" means this person is a client.`;
    case "stage":
      return `${label}: "${signal.wording}" is ${signal.stageName}.`;
  }
}

function lines(sources: ProposeSources, annotate: Partial<Record<SourceName, string>> = {}): string[] {
  return ORDER.map((name) => describeSignal(name, sources[name]) + (annotate[name] ?? ""));
}

function unavailableOf(sources: ProposeSources): SourceName[] {
  return ORDER.filter((name) => sources[name].kind === "unavailable");
}

export function proposeStage(
  lead: { currentStageId: string | null },
  sources: ProposeSources,
  stages: readonly StageOpt[],
): Proposal {
  const unavailable = unavailableOf(sources);
  const { sheet } = sources;

  // 1. A client, never a guess.
  const asksForMatter = (["sheet", "lawmatics"] as const).filter((n) => sources[n].kind === "needs_matter");
  if (asksForMatter.length > 0) {
    return {
      kind: "needs_matter",
      stage: null,
      confidence: null,
      reasons: [...lines(sources), "No stage is proposed: open a matter for this person instead."],
      evidenceDate: null,
      unavailable,
    };
  }

  // 2. No sheet stage, no proposal.
  if (sheet.kind !== "stage") {
    return {
      kind: "no_proposal",
      stage: null,
      confidence: "no_evidence",
      reasons: [...lines(sources), "No stage is proposed: the sheet is the source of truth and it names no stage for this lead."],
      evidenceDate: null,
      unavailable,
    };
  }

  // 3. Only a stage the firm has, and never one that opens a matter.
  const target = stages.find((s) => s.id === sheet.stageId);
  if (!target || target.category === "won") {
    return {
      kind: "no_proposal",
      stage: null,
      confidence: "no_evidence",
      reasons: [
        ...lines(sources),
        target
          ? `No stage is proposed: ${target.name} opens a matter, and this screen never moves a lead there.`
          : "No stage is proposed: the sheet's stage is not one of this firm's stages.",
      ],
      evidenceDate: null,
      unavailable,
    };
  }

  // 5 (computed before 4 so an unchanged row still shows how well the sources agree).
  const votes = (["lawmatics", "email"] as const).flatMap((name) => {
    const signal = sources[name];
    return signal.kind === "stage" ? [{ name, stageId: signal.stageId }] : [];
  });
  const agreeing = votes.filter((v) => v.stageId === target.id);
  const dissenting = votes.filter((v) => v.stageId !== target.id);
  const confidence: Confidence = dissenting.length > 0 ? "conflict" : agreeing.length > 0 ? "agree" : "sheet_only";

  const annotate: Partial<Record<SourceName, string>> = {};
  for (const v of agreeing) annotate[v.name] = " It matches the sheet.";
  for (const v of dissenting) annotate[v.name] = " It differs from the sheet; the sheet wins.";
  const reasons = lines(sources, annotate);

  // 4. Nothing to do.
  if (target.id === lead.currentStageId) {
    return {
      kind: "no_proposal",
      stage: null,
      confidence,
      reasons: ["Already in this stage.", ...reasons],
      evidenceDate: null,
      unavailable,
    };
  }

  reasons.push(
    confidence === "conflict"
      ? "Proposed from the sheet. Another source disagrees, so check it before accepting."
      : "Proposed from the sheet.",
  );
  return {
    kind: "stage",
    stage: { id: target.id, name: target.name },
    confidence,
    reasons,
    evidenceDate: sheet.date ?? null,
    unavailable,
  };
}

/** A row whose sheet stage is the stage the lead is already in: nothing to move. */
export function isAlreadyThere(proposal: Proposal): boolean {
  return proposal.kind === "no_proposal" && proposal.confidence !== "no_evidence" && proposal.confidence !== null;
}
