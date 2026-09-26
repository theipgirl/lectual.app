import { z } from "zod";
import { AGENT_POLICY } from "./policy";
import type { AgentContext, AgentResult } from "./types";

/**
 * Post-consult drafter: after a consultation, write the follow-up email and an
 * internal summary from the call notes, into the approval queue.
 *
 * The notes come from lectual's notetaker webhook (crm_consult_note.notes:
 * summary, marks, goods/services, next step, risk flags). This agent only
 * reads them; it never re-reads a transcript.
 *
 * Client-facing, so: it ALWAYS goes through the approval queue, at every
 * autonomy level. With no queue connected it drafts nothing and says so — a
 * client email with nowhere safe to wait is not written at all. `suggest`
 * records that a follow-up is due without drafting it.
 *
 * Fixes two things the lectual version of this flow did (post-consult-branch.ts):
 * drafts landed in crm_post_consult_action where no one reviewed them, and a
 * setting could mark an email "sent" that was never sent.
 */

export const CONSULT_BATCH = 10;
const LOOKBACK_DAYS = 14;

export const FollowUpSchema = z.object({
  subject: z.string().describe("Email subject line"),
  body: z
    .string()
    .describe("Plain-text email from the attorney to the client. Warm, specific to the call, ends with one clear next step."),
  internal_summary: z.string().describe("Two or three sentences for the attorney reviewing the draft: what was discussed and what to check"),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

const TASK = `Your job: draft the follow-up email an IP attorney sends after a consultation with a prospective client, using only the consult notes you are given. Thank them, recap what was discussed in plain language, restate the next step from the notes, and invite questions. Do not add legal analysis that is not in the notes, do not quote a price unless the notes contain it, and do not promise an outcome. Also write a short internal summary for the attorney.`;

/**
 * The firm's own sign-off (Settings → Firm profile, lectual 0073) when it has
 * one, else a placeholder the attorney fills in. Either way the draft waits in
 * the approval queue.
 */
export function followUpSystem(signOff: string | null): string {
  const ending = signOff
    ? `End the email with exactly this sign-off, unchanged:\n<sign_off>\n${signOff}\n</sign_off>`
    : `Sign off with "[Attorney name]" as a placeholder; the attorney edits and sends it.`;
  return `${AGENT_POLICY}\n\n${TASK} ${ending}`;
}

type ConsultNotes = {
  summary?: string;
  marks_discussed?: string[];
  goods_services?: string[];
  next_step?: string;
  risk_flags?: string[];
  qualification_tier?: string;
  recommended_package_hint?: string | null;
};

export function followUpPrompt(lead: { first_name: string; business_name: string | null }, notes: ConsultNotes): string {
  const list = (xs?: string[]) => (xs && xs.length ? xs.join("; ") : "(none recorded)");
  return [
    `Client first name: ${lead.first_name || "(unknown)"}`,
    `Business: ${lead.business_name ?? "(not given)"}`,
    "",
    "<consult_notes>",
    `Summary: ${notes.summary ?? "(none)"}`,
    `Marks discussed: ${list(notes.marks_discussed)}`,
    `Goods/services: ${list(notes.goods_services)}`,
    `Next step: ${notes.next_step ?? "(none recorded)"}`,
    `Package discussed: ${notes.recommended_package_hint ?? "(none recorded)"}`,
    `Risks the attorney noted: ${list(notes.risk_flags)}`,
    "</consult_notes>",
  ].join("\n");
}

export async function runPostConsult(ctx: AgentContext): Promise<AgentResult> {
  const { admin, orgId, autonomy, llm } = ctx;
  if (autonomy !== "suggest" && !ctx.queueOrgKey) {
    return { itemsIn: 0, draftsOut: 0, summary: "No approval queue is connected for this firm, so no client email was drafted.", skipped: true };
  }

  const since = new Date(ctx.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: notes, error } = await admin
    .from("crm_consult_note")
    .select("id, lead_id, notes, created_at")
    .eq("org_id", orgId)
    .not("lead_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(CONSULT_BATCH * 2);
  if (error) throw new Error(`consult note read failed: ${error.message}`);
  const withNotes = (notes ?? []).filter((n) => {
    const body = (n.notes ?? {}) as ConsultNotes;
    return Boolean(body.summary || body.next_step);
  });
  if (withNotes.length === 0) return { itemsIn: 0, draftsOut: 0, summary: "No new consult notes." };

  const { data: done, error: doneErr } = await admin
    .from("crm_activity")
    .select("payload")
    .eq("org_id", orgId)
    .in("type", ["ai_insight", "queue_drafted"])
    .eq("payload->>source", "post-consult")
    .in("payload->>consult_note_id", withNotes.map((n) => n.id));
  if (doneErr) throw new Error(`activity read failed: ${doneErr.message}`);
  const handled = new Set((done ?? []).map((d) => (d.payload as Record<string, string>).consult_note_id));
  const todo = withNotes.filter((n) => !handled.has(n.id)).slice(0, CONSULT_BATCH);

  const { data: profile } = await admin
    .from("crm_org_profile")
    .select("email_signature")
    .eq("org_id", orgId)
    .maybeSingle();
  const system = followUpSystem((profile?.email_signature as string | null | undefined)?.trim() || null);

  let drafted = 0;
  for (const note of todo) {
    const { data: lead } = await admin
      .from("crm_lead")
      .select("id, first_name, last_name, business_name, email")
      .eq("id", note.lead_id as string)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!lead) continue;
    const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.business_name || "Client";

    if (autonomy === "suggest") {
      const { error: e } = await admin.from("crm_activity").insert({
        org_id: orgId,
        lead_id: lead.id,
        type: "ai_insight",
        actor_id: null,
        actor_type: "ai",
        payload: { source: "post-consult", consult_note_id: note.id, autonomy, summary: "A post-consult follow-up is due." },
      });
      if (e) throw new Error(`activity insert failed: ${e.message}`);
      continue;
    }

    const { output } = await llm({
      system,
      user: followUpPrompt(lead, (note.notes ?? {}) as ConsultNotes),
      schema: FollowUpSchema,
      effort: "high",
      maxTokens: 8000,
    });

    const hasRealAddress = lead.email && !lead.email.toLowerCase().endsWith(".invalid");
    const { id: queueId } = await ctx.createDraft({
      orgKey: ctx.queueOrgKey as string,
      agent: "post-consult",
      type: "CLIENT_EMAIL",
      headline: `Post-consult follow-up — ${name}`,
      summary: output.internal_summary,
      clientName: name,
      recipient: hasRealAddress ? lead.email : undefined,
      subject: output.subject,
      draftBody: output.body,
    });
    drafted += 1;

    const { error: e } = await admin.from("crm_activity").insert({
      org_id: orgId,
      lead_id: lead.id,
      type: "queue_drafted",
      actor_id: null,
      actor_type: "ai",
      payload: { source: "post-consult", consult_note_id: note.id, queue_id: queueId, subject: output.subject },
    });
    if (e) throw new Error(`activity insert failed: ${e.message}`);
  }

  return {
    itemsIn: todo.length,
    draftsOut: drafted,
    summary:
      todo.length === 0
        ? "No new consult notes."
        : autonomy === "suggest"
          ? `${todo.length} follow-up(s) flagged as due.`
          : `${drafted} follow-up email(s) drafted for approval.`,
  };
}
