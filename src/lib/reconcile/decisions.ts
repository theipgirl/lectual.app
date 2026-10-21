import type { Decision, Decisions, MoveRequest, ReconcileRow } from "./types";

/**
 * The person's choices on the table, as pure functions so they are tested without a browser.
 * A skipped row has no entry. The state lives in the browser until the person applies.
 */

export function canAccept(row: ReconcileRow): boolean {
  return row.proposal.kind === "stage" && row.proposal.stage !== null;
}

/** Accept the row's proposal. Does nothing for a row that proposes no stage. */
export function accept(decisions: Decisions, row: ReconcileRow): Decisions {
  if (!canAccept(row) || !row.proposal.stage) return decisions;
  return { ...decisions, [row.leadId]: { stageId: row.proposal.stage.id, evidenceDate: row.proposal.evidenceDate, picked: false } };
}

/**
 * Pick a different stage. It replaces the target and drops the evidence date: the sheet's date was
 * evidence for the sheet's stage, not for the one the person chose. Only a stage in `allowed`
 * (the firm's stages that don't open a matter) is taken.
 */
export function pick(decisions: Decisions, leadId: string, stageId: string, allowed: readonly { id: string }[]): Decisions {
  if (!allowed.some((s) => s.id === stageId)) return decisions;
  return { ...decisions, [leadId]: { stageId, evidenceDate: null, picked: true } };
}

export function skip(decisions: Decisions, leadId: string): Decisions {
  if (!(leadId in decisions)) return decisions;
  const next = { ...decisions };
  delete next[leadId];
  return next;
}

/**
 * "Accept all where the sheet and another source agree": marks exactly the rows whose confidence is
 * `agree` and that propose a stage. A row the person already decided (accepted or picked) is left as
 * they set it. Returns the new decisions and how many rows it marked.
 */
export function acceptAgreeing(decisions: Decisions, rows: readonly ReconcileRow[]): { decisions: Decisions; marked: number } {
  let next = decisions;
  let marked = 0;
  for (const row of rows) {
    if (row.proposal.kind !== "stage" || row.proposal.confidence !== "agree") continue;
    if (row.leadId in next) continue;
    next = accept(next, row);
    marked += 1;
  }
  return { decisions: next, marked };
}

export function agreeingCount(rows: readonly ReconcileRow[]): number {
  return rows.filter((r) => r.proposal.kind === "stage" && r.proposal.confidence === "agree").length;
}

export function movesFrom(decisions: Decisions): MoveRequest[] {
  return Object.entries(decisions).map(([leadId, d]: [string, Decision]) => ({ leadId, stageId: d.stageId }));
}

export function acceptedCount(decisions: Decisions): number {
  return Object.keys(decisions).length;
}
