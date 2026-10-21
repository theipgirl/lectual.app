"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { stopLeadSequencesAsStaff } from "@/lib/campaigns/stop-staff";
import { bumpLeadLastTouch } from "@/lib/leads/touch";
import { resolveFirmSession } from "@/lib/firm/session";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { orgHasModule } from "@/lib/org/modules";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { createDraft } from "@/lib/queue/api";
import { aiConfigured, callClaude } from "@/lib/ai/claude";
import { FollowUpSchema, followUpSystem } from "@/lib/agents/post-consult";
import { getMeeting } from "@/lib/meetings/read";
import { hasMaterial, meetingFollowUpPrompt } from "@/lib/meetings/follow-up";
import { saveMeetingExtraction, type ConsultDb } from "@/lib/consult/store";
import { gateStaffAction } from "@/app/dashboard/proposals/gate";
import { draftProposalForStaff } from "@/lib/consult-proposal/staff-run";
import { meetingSource } from "@/lib/consult-proposal/shared";

/**
 * Meeting actions. Each is its own POST entry point, so each re-checks the
 * session and role itself; RLS (0081) is the real boundary underneath: staff
 * may change only a meeting's link columns, and the composite foreign keys
 * refuse a lead or matter from another firm.
 */

export type ActionState = { ok?: boolean; error?: string; notice?: string; /** Where to look at what was made. */ href?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function idOrNull(v: FormDataEntryValue | null): string | null | "bad" {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return UUID.test(s) ? s : "bad";
}

async function staffSession() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") return null;
  return CAN_WRITE_LEAD.includes(session.role) ? session : null;
}

export async function linkMeetingAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  if (!(await staffSession())) return { error: "Your role can view meetings but not link them." };
  const meetingId = idOrNull(formData.get("meetingId"));
  const leadId = idOrNull(formData.get("leadId"));
  const matterId = idOrNull(formData.get("matterId"));
  if (!meetingId || meetingId === "bad" || leadId === "bad" || matterId === "bad") return { error: "That link isn't valid." };

  const supabase = await getScopedClient();
  const { data, error } = await supabase
    .from("crm_meeting")
    .update({ lead_id: leadId, matter_id: matterId, link_source: leadId || matterId ? "staff" : null })
    .eq("id", meetingId)
    .select("id, started_at, org_id");
  if (error) return { error: error.code === "23503" ? "That lead or matter isn't in your firm." : "Couldn't save the link. Try again shortly." };
  if (!data?.length) return { error: "Meeting not found." };
  // A meeting linked to a lead is a touch on it: the Intake list sorts by the last thing that
  // happened. Best-effort, so a bump that can't land never turns a saved link into an error.
  if (leadId) await bumpLeadLastTouch(supabase, leadId, data[0].org_id);
  // SOP Stage 3: a call with the lead ends the sequences that were running
  // before it. A recorded meeting is a call that HAPPENED — the closest
  // lead-linked signal to "booked" this product has.
  const startedAt = data[0].started_at as string | null;
  if (leadId && startedAt) {
    await stopLeadSequencesAsStaff({
      leadIds: [leadId],
      reason: "booked",
      factAt: startedAt,
      enrolledBefore: startedAt,
      evidence: { meeting_id: meetingId },
    });
  }
  revalidatePath(`/dashboard/meetings/${meetingId}/`);
  revalidatePath("/dashboard/meetings/");
  if (leadId) revalidatePath(`/dashboard/leads/${leadId}/`);
  if (matterId) revalidatePath(`/dashboard/matters/${matterId}/`);
  return { ok: true, notice: leadId || matterId ? "Linked." : "Unlinked." };
}

/**
 * Drafts the follow-up email for a meeting into the APPROVAL QUEUE, with the
 * post-consult drafter's own prompt. Never sends: an attorney edits and
 * approves it in the queue, which is the only path anything takes to a client.
 *
 * Gated like the post-consult agent: the firm must hold the `agents` module,
 * have an approval queue, and the caller must be staff. One draft per meeting.
 */
export async function draftFollowUpAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession();
  if (!session) return { error: "Your role can't draft client email." };
  if (!(await orgHasModule("agents"))) return { error: "Drafting isn't turned on for your firm." };
  const meetingId = idOrNull(formData.get("meetingId"));
  if (!meetingId || meetingId === "bad") return { error: "Meeting not found." };

  const orgKey = await activeQueueOrgKey();
  if (!orgKey) return { error: "No approval queue is connected for your firm, so no client email was drafted." };
  if (!aiConfigured()) return { error: "Drafting isn't set up on this deployment yet." };

  const read = await getMeeting(meetingId);
  if (read.status !== "ok") return { error: "Couldn't load the meeting. Try again shortly." };
  const meeting = read.meeting;
  if (!meeting) return { error: "Meeting not found." };
  if (!hasMaterial(meeting)) return { error: "This meeting has no summary or transcript yet, so there's nothing to recap." };

  const supabase = await getScopedClient();
  let leadId = meeting.lead_id;
  if (!leadId && meeting.matter_id) {
    const { data: matter } = await supabase.from("crm_matter").select("lead_id").eq("id", meeting.matter_id).maybeSingle();
    leadId = (matter?.lead_id as string | null | undefined) ?? null;
  }
  if (!leadId) return { error: "Link this meeting to a lead (or a matter with a client) first, so the draft has someone to go to." };
  const { data: lead } = await supabase
    .from("crm_lead")
    .select("id, first_name, last_name, business_name, email")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { error: "The linked lead couldn't be read." };

  const { data: prior, error: priorErr } = await supabase
    .from("crm_activity")
    .select("id")
    .eq("type", "queue_drafted")
    .eq("payload->>source", "post-consult")
    .eq("payload->>meeting_id", meeting.id)
    .limit(1);
  if (priorErr) return { error: "Couldn't check for an earlier draft. Try again shortly." };
  if (prior && prior.length > 0) return { error: "A follow-up for this meeting is already in the approval queue." };

  const { data: profile } = await supabase.from("crm_org_profile").select("email_signature").maybeSingle();
  const signOff = (profile?.email_signature as string | null | undefined)?.trim() || null;

  let queueId: string;
  let subject: string;
  let extraction: unknown;
  // Also what the extraction is checked against (a basis needs a verbatim quote from it).
  const prompt = meetingFollowUpPrompt(lead, meeting);
  try {
    const { output } = await callClaude({
      system: followUpSystem(signOff),
      user: prompt,
      schema: FollowUpSchema,
      effort: "high",
      maxTokens: 8000,
    });
    const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.business_name || "Client";
    const hasRealAddress = lead.email && !lead.email.toLowerCase().endsWith(".invalid");
    const created = await createDraft({
      orgKey,
      agent: "post-consult",
      type: "CLIENT_EMAIL",
      headline: `Follow-up — ${name} (${meeting.title})`.slice(0, 200),
      summary: output.internal_summary,
      clientName: name,
      leadId: lead.id,
      recipient: hasRealAddress ? lead.email : undefined,
      subject: output.subject,
      draftBody: output.body,
      signOff,
      ...(meeting.matter_id ? { matterId: meeting.matter_id } : {}),
    });
    queueId = created.id;
    subject = output.subject;
    extraction = output.consult_details;
  } catch {
    return { error: "The draft couldn't be written or queued. Nothing was sent. Try again shortly." };
  }

  await supabase.from("crm_activity").insert({
    org_id: session.org.id,
    lead_id: lead.id,
    matter_id: meeting.matter_id,
    type: "queue_drafted",
    actor_id: session.user.id,
    actor_type: "user",
    payload: { source: "post-consult", meeting_id: meeting.id, queue_id: queueId, subject },
  });

  // The same call also read the marks, classes and filing basis off the call.
  // They go on the lead's consult details to be REVIEWED; nothing relies on
  // them until a person confirms. The draft is already queued, so a failure
  // here is told to the caller, not raised.
  const detailsSaved = await saveMeetingExtraction(supabase as unknown as ConsultDb, {
    orgId: session.org.id,
    leadId: lead.id,
    meetingId: meeting.id,
    provider: meeting.provider,
    extraction,
    sourceText: prompt,
    now: new Date(),
  });
  revalidatePath(`/dashboard/meetings/${meeting.id}/`);
  revalidatePath(`/dashboard/leads/${lead.id}/`);
  const base = "Follow-up drafted. It's waiting in the approval queue for an attorney to edit and send.";
  const extra =
    detailsSaved === "saved"
      ? " The marks, classes and filing basis it read from the call are on the lead's Consult details for review. Nothing relies on them until someone confirms."
      : detailsSaved === "failed"
        ? " The consult details couldn't be saved; you can enter them on the lead."
        : "";
  return { ok: true, notice: base + extra };
}

/**
 * Drafts a client PROPOSAL and its email from a recorded call: the proposal as
 * a draft for a named approver to review, the email in the approval queue.
 * Never sends, and nothing is visible to the client until the proposal is
 * approved and marked sent.
 *
 * Gated like "Draft follow-up" (staff, the `agents` module, an approval queue,
 * a lead to write to) plus the `proposals` module and the proposal staff
 * roles. One draft per meeting (the marker the approve gate also uses).
 */
export async function draftProposalAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const session = await staffSession();
  if (!session) return { error: "Your role can't draft client email." };
  const refused = await gateStaffAction();
  if (refused) return { error: refused.error };
  if (!(await orgHasModule("agents"))) return { error: "Drafting isn't turned on for your firm." };
  const meetingId = idOrNull(formData.get("meetingId"));
  if (!meetingId || meetingId === "bad") return { error: "Meeting not found." };

  const read = await getMeeting(meetingId);
  if (read.status !== "ok") return { error: "Couldn't load the meeting. Try again shortly." };
  const meeting = read.meeting;
  if (!meeting) return { error: "Meeting not found." };
  if (!hasMaterial(meeting)) return { error: "This meeting has no summary or transcript yet, so there's nothing to draft from." };

  const supabase = await getScopedClient();
  let leadId = meeting.lead_id;
  if (!leadId && meeting.matter_id) {
    const { data: matter } = await supabase.from("crm_matter").select("lead_id").eq("id", meeting.matter_id).maybeSingle();
    leadId = (matter?.lead_id as string | null | undefined) ?? null;
  }
  if (!leadId) return { error: "Link this meeting to a lead (or a matter with a client) first, so the draft has someone to go to." };
  const { data: lead } = await supabase
    .from("crm_lead")
    .select("id, first_name, last_name, business_name, email")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return { error: "The linked lead couldn't be read." };

  const done = await draftProposalForStaff({
    orgId: session.org.id,
    userId: session.user.id,
    source: meetingSource({
      id: meeting.id,
      title: meeting.title,
      started_at: meeting.started_at,
      summary: meeting.summary,
      transcript: meeting.transcript,
    }),
    lead: { id: lead.id, firstName: lead.first_name, lastName: lead.last_name, email: lead.email, businessName: lead.business_name },
    matterId: meeting.matter_id,
  });
  if (!done.ok) return { error: done.error };
  revalidatePath(`/dashboard/meetings/${meeting.id}/`);
  return { ok: true, notice: done.notice, href: done.href };
}
