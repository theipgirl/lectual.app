"use server";

import { revalidatePath } from "next/cache";
import { currentRole } from "@/lib/auth/current-role";
import { productionRunnerDeps } from "@/lib/agents/deps";
import { getLead } from "@/lib/pipeline";
import { runConsultPrepScoped } from "@/lib/consult-prep/trigger";
import { canRerunConsultPrep, canSendTestBrief } from "@/lib/consult-prep/roles";
import { resolveFirmSession } from "@/lib/firm/session";
import { createRateLimiter } from "@/lib/feedback/rate-limit";
import {
  CONSULT_PREP_TEST_FAILED,
  CONSULT_PREP_TEST_LIMIT,
  CONSULT_PREP_TEST_OFF,
  CONSULT_PREP_TEST_OUTCOMES,
  CONSULT_PREP_TEST_REFUSED_BEFORE_BUILD,
  CONSULT_PREP_TEST_OWNER_ONLY,
  CONSULT_PREP_TEST_SENT,
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
export async function rerunConsultPrepAction(leadId: string): Promise<RerunPrepState> {
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
}

/** S2c: at most 5 test briefs an hour per owner. In memory per server instance (like the feedback limit): a courtesy limit, not a hard cap. */
const TEST_BRIEF_LIMIT = 5;
const testBriefLimiter = createRateLimiter({ max: TEST_BRIEF_LIMIT, windowMs: 60 * 60 * 1000 });

/**
 * S2c: "Send a test brief" on the lead page. Its own POST entry point: the session is re-resolved here and only the firm's real OWNER may
 * press it (Lectual staff acting inside the firm are refused); the lead is read through the caller's scoped client and must be in the
 * session's firm. The run goes through the agent runner (the Assistants feature, the setting, Autopilot and the budget apply), with a
 * `test` scope: the engine builds a real full prep and emails it, marked [TEST], to the firm's consult prep recipients only, and writes
 * nothing. Fixed sentences only.
 */
export async function sendTestBriefAction(leadId: string): Promise<RerunPrepState> {
  try {
    const session = await resolveFirmSession();
    if (session.kind !== "ok" || !canSendTestBrief(session.role, session.actingAsStaff)) return { message: CONSULT_PREP_TEST_OWNER_ONLY };
    if (typeof leadId !== "string" || !UUID.test(leadId)) return { message: CONSULT_PREP_TEST_FAILED };
    // The slot is taken BEFORE anything is awaited (two quick presses can't both pass the check), and given back when the press is
    // refused before a build was started: nothing was spent.
    const key = session.user.id;
    if (!testBriefLimiter.allowed(key)) return { message: CONSULT_PREP_TEST_LIMIT };
    testBriefLimiter.record(key);
    let refusedBeforeBuild = true;
    try {
      const lead = await getLead(leadId);
      if (!lead || lead.merged_into_id || lead.org_id !== session.org.id) return { message: CONSULT_PREP_TEST_FAILED };
      const outcome = await runConsultPrepScoped(productionRunnerDeps(), { orgId: session.org.id, scope: { leadIds: [lead.id], reason: "test" }, trigger: "manual" });
      if (!outcome) return { message: CONSULT_PREP_TEST_OFF };
      const said = outcome.status === "ok" ? outcome.result?.summary : null;
      refusedBeforeBuild = !!said && CONSULT_PREP_TEST_REFUSED_BEFORE_BUILD.includes(said);
      if (!said || !CONSULT_PREP_TEST_OUTCOMES.includes(said)) return { message: CONSULT_PREP_TEST_FAILED };
      return { ok: said === CONSULT_PREP_TEST_SENT, message: said };
    } finally {
      if (refusedBeforeBuild) testBriefLimiter.release(key);
    }
  } catch {
    return { message: CONSULT_PREP_TEST_FAILED };
  }
}
