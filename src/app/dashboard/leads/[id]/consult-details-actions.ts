"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { logActivitySafe } from "@/lib/matters";
import { parseReviewForm } from "@/lib/consult/details";
import { saveReview } from "@/lib/consult/review";
import type { ConsultDb } from "@/lib/consult/store";

/**
 * The lead page's "Consult details" card: a person reviews or corrects what
 * the call said about each mark, and that review is what lets the details
 * carry onto the matter later. It is its own POST endpoint, so it re-checks the
 * session and role itself; RLS on org_id is the boundary underneath (a note id
 * from another firm is just "not found"). Nothing here sends anything, and no
 * module gate applies: the details are this firm's own rows, with no
 * deployment-wide credential behind them (the same reason Meetings has none).
 */

export type ConsultActionState = { ok?: boolean; error?: string; notice?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function saveConsultDetailsAction(_prev: ConsultActionState, formData: FormData): Promise<ConsultActionState> {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") return { error: "Sign in again to save this." };
  if (!CAN_WRITE_LEAD.includes(session.role)) return { error: "Your role can view consult details but not change them." };

  const leadId = String(formData.get("leadId") ?? "").trim();
  if (!UUID.test(leadId)) return { error: "That lead isn't valid." };
  const noteRaw = String(formData.get("noteId") ?? "").trim();
  if (noteRaw && !UUID.test(noteRaw)) return { error: "That consult note isn't valid." };
  const parsed = parseReviewForm(formData);
  if (!parsed.ok) return { error: parsed.error };

  const supabase = await getScopedClient();
  const { data: lead, error: leadError } = await supabase.from("crm_lead").select("id").eq("id", leadId).maybeSingle();
  if (leadError) return { error: "Couldn't save the consult details. Try again shortly." };
  if (!lead) return { error: "Lead not found." };

  const result = await saveReview(supabase as unknown as ConsultDb, {
    orgId: session.org.id,
    leadId,
    noteId: noteRaw || null,
    rev: String(formData.get("rev") ?? ""),
    input: parsed.value,
    reviewer: { userId: session.user.id, name: session.displayName, role: session.role },
    now: new Date(),
  });
  if (!result.ok) return { error: result.error };

  // The row above is the record; this is the timeline's shadow of it. Marks are
  // public trademark text, but the call's wording stays out of the payload.
  await logActivitySafe({
    type: "lead_updated",
    leadId,
    payload: {
      change: "consult_details",
      summary: `Reviewed consult details: ${result.details.marks.length} mark${result.details.marks.length === 1 ? "" : "s"}`,
      marks: result.details.marks.map((m) => ({
        mark: m.mark,
        filing_basis: m.filing_basis,
        corrected: m.extracted_basis !== null && m.extracted_basis !== m.filing_basis,
      })),
    },
  });

  revalidatePath(`/dashboard/leads/${leadId}/`);
  return { ok: true, notice: "Saved and marked reviewed. It will carry onto the matter when one is opened for this lead." };
}
