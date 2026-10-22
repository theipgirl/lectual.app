import { milestoneRank, opensMatter, topMilestone } from "./milestones";
import {
  SOURCE_LABEL,
  type Confidence,
  type EvidenceItem,
  type Proposal,
  type ProposeSources,
  type SourceName,
  type SourceSignal,
  type StageOpt,
} from "./types";

/**
 * Which stage should a lead be in? A pure function over what the sources say.
 *
 * The rule (Sprint 26; it replaced "the sheet wins"): take the MOST ADVANCED point that has evidence,
 * from any source, and prefer the newest evidence when two sources name the same point.
 *
 *  1. Evidence is every status code, Lawmatics stage, note and mail passed in. Each names a stage of
 *     the firm (through a status code, a Lawmatics stage name, or a milestone mapped by
 *     `stageForMilestone`), or names none. A fact the firm has no stage for is still cited, but it
 *     proposes nothing.
 *  2. A client signal (a sheet status code of 7 or higher, Lawmatics "Hired", or a top milestone of
 *     accepted / paid / hired) gives `needs_matter` and NO stage. This screen never moves anyone to a
 *     stage that opens a matter.
 *  3. Otherwise the furthest stage wins. Ties go to the newest evidence.
 *  4. A lead is never moved backwards: a target before the lead's current stage proposes nothing.
 *  5. `declined` and `nurture` are proposed only from an explicit note that is at least as new as every
 *     piece of progress. Silence never proposes them.
 *  6. Confidence: `agree` when two or more sources each point at the proposed stage; `conflict` when a
 *     source points elsewhere (a status older than the notes, say) -- the proposal is still the most
 *     advanced evidenced stage; `sheet_only` / `single_source` when one source speaks.
 *
 * A source that is unavailable, said nothing, or named a stage the firm does not have never votes, and
 * an unavailable source is named in the reasons and in `unavailable`: it is not "no stage".
 */

export const ALREADY_THERE = "Already in this stage.";

const ORDER: readonly SourceName[] = ["sheet", "lawmatics", "email"];

const VIA_LABEL: Record<SourceName, Record<EvidenceItem["via"], string>> = {
  sheet: { status: "sheet status", note: "sheet note", stage: "sheet status", mail: "sheet", mailbox: "sheet", agent: "sheet" },
  lawmatics: { status: "Lawmatics", note: "Lawmatics note", stage: "Lawmatics stage", mail: "Lawmatics", mailbox: "Lawmatics", agent: "Lawmatics" },
  email: { status: "email", note: "email", stage: "email", mail: "email", mailbox: "mailbox search", agent: "Stage Keeper" },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Oct 16" (UTC day), with the year when it differs from `refYear`. */
export function formatDay(iso: string | null, refYear?: number): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const day = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return refYear !== undefined && d.getUTCFullYear() !== refYear ? `${day}, ${d.getUTCFullYear()}` : day;
}

export function describeEvidence(item: EvidenceItem, refYear?: number): string {
  const date = formatDay(item.date, refYear);
  return `${item.label}${date ? ` ${date}` : ""} (${VIA_LABEL[item.source][item.via]})`;
}

function time(iso: string | null): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
}

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
      return `${label}: "${signal.wording}" doesn't match any of this firm's stages, so it doesn't count as a stage.`;
    case "needs_matter":
      return `${label}: "${signal.wording}" means this person is a client.`;
    case "stage":
      return `${label}: "${signal.wording}" is ${signal.stageName}.`;
  }
}

function unavailableOf(sources: ProposeSources): SourceName[] {
  return ORDER.filter((name) => sources[name].kind === "unavailable");
}

/** The status-level readings as evidence, so one list holds everything the proposal rests on. */
export function signalEvidence(sources: ProposeSources): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (const source of ORDER) {
    const signal = sources[source];
    const via = source === "sheet" ? "status" : source === "lawmatics" ? "stage" : "mail";
    if (signal.kind === "stage") {
      out.push({ source, via, milestone: null, label: signal.wording, date: signal.date ?? null, stageId: signal.stageId });
    } else if (signal.kind === "needs_matter" && source !== "email") {
      out.push({ source, via, milestone: null, label: signal.wording, date: null, stageId: null, matter: true });
    }
  }
  return out;
}

function newestFirst(items: readonly EvidenceItem[]): EvidenceItem[] {
  return [...items].sort((a, b) => time(b.date) - time(a.date));
}

export function proposeStage(
  lead: { currentStageId: string | null },
  sources: ProposeSources,
  stages: readonly StageOpt[],
  extra: readonly EvidenceItem[] = [],
): Proposal {
  const unavailable = unavailableOf(sources);
  const items = newestFirst([...signalEvidence(sources), ...extra]);
  const years = items.map((i) => (i.date ? new Date(i.date).getUTCFullYear() : NaN)).filter(Number.isFinite);
  const refYear = years.length > 0 ? Math.max(...years) : undefined;
  const evidenceLine = items.length > 0 ? `Evidence: ${items.map((i) => describeEvidence(i, refYear)).join(" · ")}.` : null;
  const sourceLines = ORDER.map((name) => describeSignal(name, sources[name]));
  const base = (reasons: string[]) => [...(evidenceLine ? [evidenceLine] : []), ...reasons];

  // 2. A client, never a guess.
  // Only DATED milestone evidence counts; an undated note is cited and never acted on.
  const milestones = items.flatMap((i) => (i.milestone && i.date ? [i.milestone] : []));
  const top = topMilestone(milestones);
  const signalsClient = items.some((i) => i.matter && i.milestone === null);
  const milestoneClient = top !== null && opensMatter(top);
  if (signalsClient || milestoneClient) {
    return {
      kind: "needs_matter",
      stage: null,
      confidence: null,
      reasons: [...base(sourceLines), "No stage is proposed: open a matter for this person instead."],
      evidenceDate: null,
      unavailable,
      evidence: items,
    };
  }

  const byId = new Map(stages.map((s) => [s.id, s]));
  const current = lead.currentStageId ? byId.get(lead.currentStageId) : undefined;

  // Each source's furthest stage, for the confidence call and the winner.
  type Claim = { item: EvidenceItem; stage: StageOpt };
  const progress: Claim[] = [];
  const exits: Claim[] = [];
  for (const item of items) {
    if (!item.stageId) continue;
    const stage = byId.get(item.stageId);
    if (!stage) continue;
    // An exit mapped to a won-category stage would open a matter, which this screen never does: no claim.
    if (item.milestone === "declined" || item.milestone === "nurture") {
      if (stage.category !== "won") exits.push({ item, stage });
    }
    else progress.push({ item, stage });
  }
  const wonOnly = progress.length > 0 && progress.every((c) => c.stage.category === "won");

  // 5. An explicit decline / nurture note, at least as new as all progress.
  const newestProgress = Math.max(
    Number.NEGATIVE_INFINITY,
    ...items.filter((i) => i.milestone !== null && milestoneRank(i.milestone) !== null).map((i) => time(i.date)),
    ...progress.map((c) => time(c.item.date)),
  );
  const exit = exits
    .filter((c) => c.item.date !== null && time(c.item.date) >= newestProgress)
    .sort((a, b) => time(b.item.date) - time(a.item.date) || (a.item.milestone === "nurture" ? -1 : 1))[0];

  const candidates = progress.filter((c) => c.stage.category !== "won");
  let winner: Claim | undefined = exit;
  if (!winner) {
    winner = candidates.sort((a, b) => b.stage.orderIndex - a.stage.orderIndex || time(b.item.date) - time(a.item.date))[0];
  }

  if (!winner) {
    const reasons = base(sourceLines);
    reasons.push(
      wonOnly
        ? "No stage is proposed: the only stage named opens a matter, and this screen never moves a lead there."
        : items.length > 0
          ? "No stage is proposed: none of this evidence names a stage this firm has."
          : "No stage is proposed: none of the sources names a stage for this lead.",
    );
    return { kind: "no_proposal", stage: null, confidence: "no_evidence", reasons, evidenceDate: null, unavailable, evidence: items };
  }

  const target = winner.stage;
  const isExit = winner === exit;

  // 6. Confidence. A source "speaks" through any claim; it AGREES when its furthest claim is the proposed
  // stage. A status-level reading (a sheet status code, a Lawmatics stage, the latest typed mail) that names
  // another stage is a source pointing elsewhere, usually backward: that is the conflict. A note or mail that
  // is merely earlier history in the same journey is not.
  const atTarget = new Set<SourceName>();
  const speaking = new Set<SourceName>();
  const furthest = new Map<SourceName, StageOpt>();
  for (const c of [...candidates, ...(isExit ? [winner] : [])]) {
    speaking.add(c.item.source);
    const have = furthest.get(c.item.source);
    if (!have || c.stage.orderIndex > have.orderIndex) furthest.set(c.item.source, c.stage);
  }
  for (const [source, stage] of furthest) if (stage.id === target.id) atTarget.add(source);
  const dissent = candidates.some((c) => c.item.milestone === null && c.stage.id !== target.id);
  let confidence: Confidence;
  if (speaking.size === 0) confidence = "no_evidence";
  else if (dissent) confidence = "conflict";
  else if (atTarget.size >= 2) confidence = "agree";
  else confidence = atTarget.has("sheet") || (speaking.size === 1 && speaking.has("sheet")) ? "sheet_only" : "single_source";

  const sameStageDates = candidates.filter((c) => c.stage.id === target.id).map((c) => c.item.date).filter((d): d is string => d !== null);
  const dates = isExit ? (winner.item.date ? [winner.item.date] : []) : sameStageDates;
  const evidenceDate = dates.sort((a, b) => time(b) - time(a))[0] ?? null;

  if (target.id === lead.currentStageId) {
    return {
      kind: "no_proposal",
      stage: null,
      confidence,
      reasons: [ALREADY_THERE, ...base(sourceLines)],
      evidenceDate: null,
      unavailable,
      evidence: items,
    };
  }

  // 4. Never backwards (an explicit decline or nurture note is the one exception).
  if (!isExit && current && target.orderIndex < current.orderIndex) {
    return {
      kind: "no_proposal",
      stage: null,
      confidence,
      reasons: [
        ...base(sourceLines),
        `No stage is proposed: the furthest evidenced stage (${target.name}) is before the lead's current stage (${current.name}), and a lead is never moved backwards here.`,
      ],
      evidenceDate: null,
      unavailable,
      evidence: items,
    };
  }

  const reasons = base(sourceLines);
  reasons.push(
    confidence === "conflict"
      ? `Proposed from the most advanced evidence (${target.name}). A source points elsewhere, so check it before accepting.`
      : `Proposed from the most advanced evidence (${target.name}).`,
  );
  return {
    kind: "stage",
    stage: { id: target.id, name: target.name },
    confidence,
    reasons,
    evidenceDate,
    unavailable,
    evidence: items,
  };
}

/** A row whose evidence points at the stage the lead is already in: nothing to move. */
export function isAlreadyThere(proposal: Proposal): boolean {
  return proposal.kind === "no_proposal" && proposal.reasons[0] === ALREADY_THERE;
}
