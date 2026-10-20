"use server";

import { resolveFirmSession } from "@/lib/firm/session";
import { getScopedClient } from "@/lib/db/scoped-client";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { gateStaffAction } from "@/app/dashboard/proposals/gate";
import { draftProposalForStaff } from "@/lib/consult-proposal/staff-run";
import { transcriptTextFromForm } from "@/lib/consult-proposal/form-text";

export type PasteProposalState = { ok?: boolean; error?: string; notice?: string; href?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * "Draft from a transcript": staff paste what was said on a consult, or upload
 * it as a .txt, .vtt, .srt or .docx, and the consult agent drafts the proposal
 * (for a named approver) and its email (for the approval queue). Nothing is sent.
 *
 * The text (and any uploaded file) is untrusted data and is stored nowhere: only
 * the quotes the agent relied on (checked against it) go on the proposal's
 * activity log, and a hash of the text marks the call as drafted so a second
 * click is refused. Each action is its own POST endpoint, so this re-checks the
 * session, the lead-writing role, the `proposals` module and the proposal staff
 * roles.
 */
export async function draftProposalFromTranscriptAction(_prev: PasteProposalState, formData: FormData): Promise<PasteProposalState> {
  const session = await resolveFirmSession();
  if (session.kind !== "ok" || !CAN_WRITE_LEAD.includes(session.role)) return { error: "Your role can't draft client email." };
  const refused = await gateStaffAction();
  if (refused) return { error: refused.error };

  const leadId = String(formData.get("leadId") ?? "").trim();
  if (!UUID.test(leadId)) return { error: "Lead not found." };
  // A chosen file wins over the pasted text; the same helper the proposals page uses.
  const transcript = await transcriptTextFromForm(formData);
  if (!transcript.ok) return { error: transcript.error };
  const text = transcript.text;

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
    source: { kind: "pasted", text },
    lead: { id: lead.id, firstName: lead.first_name, lastName: lead.last_name, email: lead.email, businessName: lead.business_name },
    matterId: null,
  });
  return done.ok ? { ok: true, notice: done.notice, href: done.href } : { error: done.error };
}
