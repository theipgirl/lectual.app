import type { StageOpt } from "@/lib/reconcile/types";
import {
  SUGGEST_ONLY_SIGNALS,
  signalIdFor,
  signalTime,
  type KeeperSignal,
  type SignalId,
} from "@/lib/stage-keeper/signals";
import { stageForSignal, type StageMapping } from "./mapping";

/**
 * From a lead's signals to the one stage the Stage Keeper would place it in. Pure: no
 * database, no clock beyond the optional `now`, so every guardrail is a table test.
 *
 * The answer is one of three things.
 *   nothing  the signals place nobody (with the reason, so a run can count it)
 *   move     put the lead in this stage: strictly forward, an ordinary open stage, and not
 *            a welcome or payment signal
 *   suggest  the same stage, but only as a card a person accepts (won, lost, nurture,
 *            welcome or payment, or a lead already in a closing stage)
 *
 * A target that is not strictly later than the lead's current stage is "nothing", never a
 * suggestion: the agent only ever points forward. Of several signals the one whose stage is
 * furthest forward wins, ties going to the newest evidence.
 */

export type TargetLead = { currentStageId: string };

export type NothingReason =
  | "no-signals"
  | "sensitive"
  | "unknown-stage"
  | "already-client"
  | "unresolved"
  | "not-forward";

export type TargetWhy = "won" | "lost" | "nurture" | "welcome-or-payment" | "current-stage";

export type TargetResult =
  | { kind: "nothing"; reason: NothingReason }
  | { kind: "move"; stage: StageOpt; signalId: SignalId; signal: KeeperSignal }
  | { kind: "suggest"; stage: StageOpt; why: TargetWhy; signalId: SignalId; signal: KeeperSignal };

export type TargetOptions = {
  /** When given, a consult that has already started is not a "booked future consult". */
  now?: number;
};

type Candidate = { stage: StageOpt; signalId: SignalId; signal: KeeperSignal; time: number };

function isSensitive(signal: KeeperSignal): boolean {
  return signal.source !== "payment" && signal.sensitive;
}

export function targetStageFromSignals(
  lead: TargetLead,
  signals: readonly KeeperSignal[],
  stages: readonly StageOpt[],
  mapping: StageMapping,
  options: TargetOptions = {},
): TargetResult {
  // Sensitive mail (opposing counsel, a dispute, a bar complaint) never moves or suggests.
  if (signals.some(isSensitive)) return { kind: "nothing", reason: "sensitive" };
  if (signals.length === 0) return { kind: "nothing", reason: "no-signals" };

  const current = stages.find((s) => s.id === lead.currentStageId);
  if (!current) return { kind: "nothing", reason: "unknown-stage" };
  // A lead already in a stage that opens a matter is a client: a person put it there.
  if (current.category === "won") return { kind: "nothing", reason: "already-client" };

  const candidates: Candidate[] = [];
  let resolvedAny = false;
  for (const signal of signals) {
    if (signal.source === "calendar" && options.now !== undefined && Date.parse(signal.startsAt) < options.now) continue;
    const signalId = signalIdFor(signal);
    if (!signalId) continue;
    const stage = stageForSignal(signalId, stages, mapping);
    if (!stage) continue;
    resolvedAny = true;
    if (stage.orderIndex <= current.orderIndex) continue; // forward only
    candidates.push({ stage, signalId, signal, time: signalTime(signal) });
  }
  if (candidates.length === 0) return { kind: "nothing", reason: resolvedAny ? "not-forward" : "unresolved" };

  const best = candidates.reduce((a, b) =>
    b.stage.orderIndex > a.stage.orderIndex || (b.stage.orderIndex === a.stage.orderIndex && b.time > a.time) ? b : a,
  );

  const why = suggestionWhy(best, current);
  if (why) return { kind: "suggest", stage: best.stage, why, signalId: best.signalId, signal: best.signal };
  return { kind: "move", stage: best.stage, signalId: best.signalId, signal: best.signal };
}

/** Why this placement is only a suggestion, or null when the agent may make it itself. */
function suggestionWhy(best: Candidate, current: StageOpt): TargetWhy | null {
  const { category } = best.stage;
  if (category === "won") return "won";
  if (category === "lost") return "lost";
  if (category === "nurture") return "nurture";
  if (category !== "open") return "current-stage"; // an unknown category is never moved to
  if (SUGGEST_ONLY_SIGNALS.has(best.signalId)) return "welcome-or-payment";
  if (current.category === "lost" || current.category === "nurture") return "current-stage";
  return null;
}
