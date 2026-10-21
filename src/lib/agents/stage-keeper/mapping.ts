import { resolveStage } from "@/lib/lawmatics/stage-map";
import type { StageOpt } from "@/lib/reconcile/types";
import { isSignalId, type SignalId } from "@/lib/stage-keeper/signals";

/**
 * Which of the firm's stages each signal names.
 *
 * Two sources, in this order. First the firm brain: an entry of category `stage_mapping`
 * whose key is the signal id (`consult-scheduled`, `loe-invoice-sent`, ...) and which says the
 * stage's name in `data.stage`, else in its body. Then, for a signal with NO entry, the
 * default names below, resolved against the firm's own stages with `resolveStage`
 * (case, punctuation, "&" / "and" and a leading list number do not matter).
 *
 * Never a guess. A brain entry that names a stage the firm does not have gives nothing for
 * that signal (it does not fall back to the default, because the firm said what it meant),
 * and a signal that resolves to nothing places nobody.
 */

/** The one table of default stage names. Candidates are tried in order; the first the firm has wins. */
export const DEFAULT_STAGE_NAMES: Record<SignalId, readonly string[]> = {
  "consult-scheduled": ["Consultation Scheduled", "Consult Scheduled", "Consult Booked", "Strategy Session Scheduled", "Discovery Call Scheduled"],
  "questionnaire-sent": ["Questionnaire Sent", "Intake Questionnaire Sent", "Questionnaire"],
  "post-consult-sent": ["Post Consultation Email Sent", "Post Consult Email Sent", "Post Consultation Follow Up"],
  "loe-invoice-sent": ["LOE & Invoice Sent", "Pending LOE + Payment", "Engagement Letter Sent"],
  "welcome-sent": ["Welcome Email Sent", "Welcome Sent"],
  "payment-received": ["Signed LOE / Deposit Received", "Deposit Received"],
};

/** signal id -> the stage name the firm brain says it means. */
export type StageMapping = Partial<Record<SignalId, string>>;

type BrainRow = { key?: unknown; body?: unknown; data?: unknown };

/** The `stage_mapping` entries that name a signal; every other entry (the Lawmatics map, say) is ignored. */
export function parseStageMapping(entries: readonly BrainRow[]): StageMapping {
  const out: StageMapping = {};
  for (const entry of entries) {
    const key = typeof entry.key === "string" ? entry.key.trim().toLowerCase() : "";
    if (!isSignalId(key)) continue;
    const data = entry.data && typeof entry.data === "object" && !Array.isArray(entry.data) ? (entry.data as Record<string, unknown>) : {};
    const fromData = typeof data.stage === "string" ? data.stage.trim() : "";
    const fromBody = typeof entry.body === "string" ? entry.body.trim() : "";
    const name = fromData || fromBody;
    if (name) out[key] = name;
  }
  return out;
}

/** The firm's stage this signal names, or null (never a first-stage fallback). */
export function stageForSignal(signal: SignalId, stages: readonly StageOpt[], mapping: StageMapping): StageOpt | null {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const named = mapping[signal];
  if (named !== undefined) {
    const hit = resolveStage(named, stages);
    return hit.ok ? (byId.get(hit.stage.id) ?? null) : null;
  }
  for (const candidate of DEFAULT_STAGE_NAMES[signal]) {
    const hit = resolveStage(candidate, stages);
    if (hit.ok) return byId.get(hit.stage.id) ?? null;
  }
  return null;
}
