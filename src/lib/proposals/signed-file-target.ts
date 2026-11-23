import { keeperForWrite } from "@/lib/leads/live";
import type { FilingTarget } from "./signed-loe-file";
import { STEP_TEXT } from "./step-text";

/**
 * Where the signed letter is filed in Lectual: the proposal's `matter_id`, else its `lead_id` followed to its keeper (a lead merged
 * into another keeps its history on the keeper; `keeperForWrite` reads the pointer, and one that can't be read is `failed`, never a
 * guess). Neither is `blocked` with a sentence a person can act on. The ids come from the PROPOSAL ROW, never from input.
 */
export async function resolveFilingTarget(db: unknown, row: { orgId: string; matterId: string | null; leadId: string | null }): Promise<FilingTarget> {
  if (row.matterId) return { ok: true, kind: "matter", id: row.matterId };
  if (row.leadId) {
    try {
      return { ok: true, kind: "lead", id: await keeperForWrite(db, row.leadId, row.orgId) };
    } catch {
      return { ok: false, kind: "failed", reason: STEP_TEXT.fileParentUnreadable };
    }
  }
  return { ok: false, kind: "blocked", reason: STEP_TEXT.signedNoParent };
}
