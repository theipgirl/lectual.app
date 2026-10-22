"use server";

import { revalidatePath } from "next/cache";
import { placeholderEmailFor } from "@/lib/intake/sheet-import";
import { logActivitySafe } from "@/lib/matters/activity";
import { authorizeReconcile } from "@/lib/reconcile/authorize";
import { FOUND_LABEL, parseCandidate } from "@/lib/reconcile/create-lead";
import { firstOpenStage } from "@/lib/reconcile/plan";
import { RECONCILE_MESSAGES as MSG } from "@/lib/reconcile/rules";
import { readStages } from "@/lib/reconcile/sources";

/**
 * "Create lead" for a person listed under "Not in Lectual yet". Nothing is created until this is called
 * for that one person. The role is re-resolved on every call (owner / admin / senior admin only), every
 * read and write goes through the caller's scoped client (RLS is the tenant boundary; no org id is
 * accepted from the browser), and every sentence returned is fixed.
 *
 * The person is filed with where they were found as the source, the sheet's key and Lawmatics id when
 * known (so the next preview reconciles them like any lead), the sheet's stage when it names one the
 * firm has, else the firm's first open stage. A stage that opens a matter is never used.
 */

export type CreateLeadResult = { ok: true; leadId: string; name: string } | { ok: false; error: string };

export async function createLeadFromReconcileAction(input: unknown): Promise<CreateLeadResult> {
  const auth = await authorizeReconcile();
  if (!auth.ok) return auth;
  const { supabase } = auth;

  const candidate = parseCandidate(input);
  if (!candidate) return { ok: false, error: MSG.createBadRequest };

  let stages;
  try {
    stages = await readStages(supabase);
  } catch {
    return { ok: false, error: MSG.stagesUnreadable };
  }
  const named = candidate.stageId ? stages.find((s) => s.id === candidate.stageId && s.category !== "won") : undefined;
  const stage = named ?? firstOpenStage(stages);
  if (!stage) return { ok: false, error: MSG.createNoStage };

  // One lead per person: refuse when the key, the Lawmatics id or the address is already a lead.
  try {
    for (const [column, value] of [
      ["sheet_key", candidate.sheetKey],
      ["lawmatics_id", candidate.lawmaticsId],
      ["email", candidate.email],
    ] as const) {
      if (!value) continue;
      const { data, error } = await supabase.from("crm_lead").select("id").eq(column, value).limit(1);
      if (error) throw error;
      if ((data ?? []).length > 0) return { ok: false, error: MSG.createExists };
    }
  } catch {
    return { ok: false, error: MSG.createReadFailed };
  }

  let orgId: string;
  try {
    const { data, error } = await supabase.rpc("current_org_id");
    if (error || typeof data !== "string" || !data) return { ok: false, error: MSG.createFailed };
    orgId = data;
  } catch {
    return { ok: false, error: MSG.createFailed };
  }

  const now = new Date().toISOString();
  const email = candidate.email ?? placeholderEmailFor(candidate.sheetKey ?? `lm${candidate.lawmaticsId ?? "x"}`);
  const { data, error } = await supabase
    .from("crm_lead")
    .insert({
      org_id: orgId,
      first_name: candidate.firstName,
      last_name: candidate.lastName,
      email,
      business_name: candidate.businessName,
      practice_area: candidate.practiceArea,
      current_stage_id: stage.id,
      sheet_key: candidate.sheetKey,
      lawmatics_id: candidate.lawmaticsId,
      referral_detail: FOUND_LABEL[candidate.found],
      stage_entered_at: now,
      last_activity_at: now,
    })
    .select("id")
    .single();
  if (error || !data) {
    console.error("[reconcile] create lead failed", error?.code ?? "error");
    return { ok: false, error: MSG.createFailed };
  }

  const name = `${candidate.firstName} ${candidate.lastName}`.trim();
  await logActivitySafe({
    type: "lead_created",
    leadId: data.id,
    payload: { summary: name, stage_id: stage.id, source: "reconcile", found: candidate.found },
  });
  revalidatePath("/dashboard/intake/");
  revalidatePath("/dashboard/leads/");
  return { ok: true, leadId: data.id, name };
}
