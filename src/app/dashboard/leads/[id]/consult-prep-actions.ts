"use server";

import { revalidatePath } from "next/cache";
import { previewSafe } from "@/lib/views/preview-safe";
import { currentRole } from "@/lib/auth/current-role";
import { productionRunnerDeps } from "@/lib/agents/deps";
import { getLead } from "@/lib/pipeline";
import { runConsultPrepScoped } from "@/lib/consult-prep/trigger";
import { canRerunConsultPrep } from "@/lib/consult-prep/roles";
import {
  CONSULT_PREP_RERUN_DONE,
  CONSULT_PREP_RERUN_FAILED,
  CONSULT_PREP_RERUN_NOTHING,
  CONSULT_PREP_RERUN_NOT_ALLOWED,
  CONSULT_PREP_RERUN_OFF,
} from "@/lib/ui/words";

export type RerunPrepState = { ok?: boolean; message?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Re-run prep" on the lead page. Its own POST entry point: the role is re-read here (owner, admin, senior admin or attorney), the
 * lead is read through the caller's scoped client (another firm's id is just "not found"), and the firm is the LEAD ROW'S own.
 * The run goes through the agent runner, so the Assistants feature, the setting, Autopilot and the budget all still apply. It
 * prepares this lead with a fresh key (a new brief and a new booked email); reminders already scheduled are not repeated.
 * Fixed sentences only.
 */
export const rerunConsultPrepAction = previewSafe(async function rerunConsultPrepAction(leadId: string): Promise<RerunPrepState> {
  try {
    if (!canRerunConsultPrep(await currentRole())) return { message: CONSULT_PREP_RERUN_NOT_ALLOWED };
    if (typeof leadId !== "string" || !UUID.test(leadId)) return { message: CONSULT_PREP_RERUN_FAILED };
    const lead = await getLead(leadId);
    if (!lead || lead.merged_into_id) return { message: CONSULT_PREP_RERUN_FAILED };
    const outcome = await runConsultPrepScoped(productionRunnerDeps(), { orgId: lead.org_id, scope: { leadIds: [lead.id], reason: "rerun" }, trigger: "manual" });
    if (!outcome) return { message: CONSULT_PREP_RERUN_OFF };
    if (outcome.status === "error") return { message: CONSULT_PREP_RERUN_FAILED };
    if (outcome.status === "skipped" || !outcome.result || outcome.result.itemsIn === 0) return { message: CONSULT_PREP_RERUN_NOTHING };
    revalidatePath(`/dashboard/leads/${lead.id}/`);
    return { ok: true, message: CONSULT_PREP_RERUN_DONE };
  } catch {
    return { message: CONSULT_PREP_RERUN_FAILED };
  }
}, (message) => ({ ok: false, message }))
