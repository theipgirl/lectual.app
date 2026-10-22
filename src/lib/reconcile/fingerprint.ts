import { createHash } from "node:crypto";
import type { PlanRow } from "./types";

/**
 * SHA-256 of the plan the person was shown, in a canonical form: rows sorted by lead id, keys in a
 * fixed order (the proposed last touch included), absent values written as null. The same plan in a different row order hashes the
 * same; any single changed field hashes differently.
 *
 * This is an integrity check that apply is working from the plan that was previewed, not a
 * signature: it has no secret. What stops a wrong or forged move is that apply also re-reads each
 * lead and each stage through the caller's own scoped client, and RLS decides what that client sees.
 */
export function canonicalPlan(plan: readonly PlanRow[]): string {
  const rows = [...plan]
    .sort((a, b) => (a.leadId < b.leadId ? -1 : a.leadId > b.leadId ? 1 : 0))
    .map((r) => [r.leadId, r.fromStageId, r.proposedStageId ?? null, r.evidenceDate ?? null, r.confidence ?? null, r.lastTouch ?? null]);
  return JSON.stringify(rows);
}

export function planFingerprint(plan: readonly PlanRow[]): string {
  return createHash("sha256").update(canonicalPlan(plan)).digest("hex");
}
