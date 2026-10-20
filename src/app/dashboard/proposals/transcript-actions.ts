"use server";

import { resolveFirmSession } from "@/lib/firm/session";
import { getScopedClient } from "@/lib/db/scoped-client";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { draftProposalForStaff } from "@/lib/consult-proposal/staff-run";
import { transcriptTextFromForm } from "@/lib/consult-proposal/form-text";
import { gateStaffAction } from "./gate";

export type TranscriptDraftState = { ok?: boolean; error?: string; notice?: string; href?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Draft from a transcript", started from the proposals page: the person picks
 * a lead and pastes the transcript or uploads a .txt, .vtt, .srt or .docx. The
 * text then goes through the same `draftProposalForStaff` the lead page uses,
 * as a pasted source, so the agent drafts a proposal for a named approver and
 * an email for the approval queue. This file sends nothing and approves nothing.
 *
 * Each action is its own POST endpoint, so this re-checks the module, the
 * proposal staff roles, the session and the lead-writing role. The lead is read
 * through the caller's own scoped client: another firm's lead id is "not found".
 * The text and any file are stored nowhere.
 */
export async function draftProposalFromUploadAction(_prev: TranscriptDraftState, formData: FormData): Promise<TranscriptDraftState> {
  const refused = await gateStaffAction();
  if (refused) return { error: refused.error };
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !CAN_WRITE_LEAD.includes(session.role)) return { error: "Your role can't draft client email." };

  const leadId = String(formData.get("leadId") ?? "").trim();
  if (!UUID.test(leadId)) return { error: "Choose the lead this call was with." };

  const transcript = await transcriptTextFromForm(formData);
  if (!transcript.ok) return { error: transcript.error };

  const supabase = await getScopedClient();
  const { data: lead } = await supabase
    .from("crm_lead")
    .select("id, first_name, last_name, business_name, email")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { error: "Lead not found." };

  const done = await draftProposalForStaff({
    orgId: session.org.id,
    userId: session.user.id,
    source: { kind: "pasted", text: transcript.text },
    lead: { id: lead.id, firstName: lead.first_name, lastName: lead.last_name, email: lead.email, businessName: lead.business_name },
    matterId: null,
  });
  return done.ok ? { ok: true, notice: done.notice, href: done.href } : { error: done.error };
}
