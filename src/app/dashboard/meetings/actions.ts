"use server";

import { revalidatePath } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { CAN_WRITE_LEAD } from "@/lib/pipeline/leads";
import { orgHasModule } from "@/lib/org/modules";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { createDraft } from "@/lib/queue/api";
import { aiConfigured, callClaude } from "@/lib/ai/claude";
import { FollowUpSchema, followUpSystem } from "@/lib/agents/post-consult";
import { getMeeting } from "@/lib/meetings/read";
import { hasMaterial, meetingFollowUpPrompt } from "@/lib/meetings/follow-up";

/**
 * Meeting actions. Each is its own POST entry point, so each re-checks the
 * session and role itself; RLS (0077) is the real boundary underneath: staff
 * may change only a meeting's link columns, and the composite foreign keys
 * refuse a lead or matter from another firm.
 */

export type ActionState = { ok?: boolean; error?: string; notice?: string };

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
    .select("id");
  if (error) return { error: error.code === "23503" ? "That lead or matter isn't in your firm." : "Couldn't save the link. Try again shortly." };
  if (!data?.length) return { error: "Meeting not found." };
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
  try {
    const { output } = await callClaude({
      system: followUpSystem(signOff),
      user: meetingFollowUpPrompt(lead, meeting),
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
      recipient: hasRealAddress ? lead.email : undefined,
      subject: output.subject,
      draftBody: output.body,
      ...(meeting.matter_id ? { matterId: meeting.matter_id } : {}),
    });
    queueId = created.id;
    subject = output.subject;
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
  revalidatePath(`/dashboard/meetings/${meeting.id}/`);
  return { ok: true, notice: "Follow-up drafted. It's waiting in the approval queue for an attorney to edit and send." };
}
