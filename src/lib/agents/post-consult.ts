import { z } from "zod";
import { ConsultDetailsExtractSchema } from "@/lib/consult/details";
import { saveExtraction, type ConsultDb } from "@/lib/consult/store";
import { runConsultProposal } from "@/lib/consult-proposal/run";
import { CONSULT_PROPOSAL_SOURCE, meetingSource } from "@/lib/consult-proposal/shared";
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
 *
 * The same call also returns `consult_details` (src/lib/consult/details.ts):
 * per mark, what the call said about word vs design, classes with goods/services
 * and the filing basis (1a in use / 1b intent to use / unknown), plus the package
 * and any discount discussed. It is extraction of what was said, never advice,
 * and it is stored on the consult note for a person to review on the lead page
 * before anything relies on it. Saving it never blocks or undoes the draft.
 */

export const CONSULT_BATCH = 10;
/** Recorded calls turned into a proposal + email per run (each is one long model call). */
export const PROPOSAL_MEETING_BATCH = 5;
/** Recent linked calls looked at per run, newest first, to find the ones not drafted yet. */
export const PROPOSAL_SCAN_LIMIT = 50;
/**
 * No new proposal is STARTED once this much of the run has gone (measured from
 * the start of the post-consult run, notes path included). One high-effort call
 * can take a minute or two, and /api/cron/agents stops at 300s: a run killed
 * between the proposal insert and its marker would leave an unlinked queue item
 * and draft the call again next time. What is left is picked up on the next run.
 */
export const PROPOSAL_TIME_BUDGET_MS = 120_000;
const LOOKBACK_DAYS = 14;

export const FollowUpSchema = z.object({
  subject: z.string().describe("Email subject line"),
  body: z
    .string()
    .describe("Plain-text email from the attorney to the client. Warm, specific to the call, ends with one clear next step."),
  internal_summary: z.string().describe("Two or three sentences for the attorney reviewing the draft: what was discussed and what to check"),
  consult_details: ConsultDetailsExtractSchema.describe(
    "A record of what the notes say about each mark, for the attorney to check. Extraction only: it is never put in the email",
  ),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;

const TASK = `Your job: draft the follow-up email an IP attorney sends after a consultation with a prospective client, using only the consult notes you are given. Thank them, recap what was discussed in plain language, restate the next step from the notes, and invite questions. Do not add legal analysis that is not in the notes, do not quote a price unless the notes contain it, and do not promise an outcome. Also write a short internal summary for the attorney.`;

/**
 * The extraction half of the same call. Worded as reporting, because the filing
 * basis is the attorney's determination (SOP §4) and the software must not make
 * it: a basis is only ever what the notes say, with the words that say it.
 */
const EXTRACTION_TASK = `Also fill in consult_details: a record of what the notes say about each mark, for the attorney to check. This is extraction, not advice. For each mark discussed give the mark text; whether it was described as a word mark or a design mark (unknown if the notes do not say); and each class with its goods or services as the notes state them, giving a class number only if the notes give one. For filing_basis answer 1a only if the notes say the mark is already in use in commerce, 1b only if they say it is not yet in use and the client intends to use it, and otherwise unknown, and copy the exact words from the notes that state it into basis_evidence (a short verbatim quote, not a paraphrase: a basis whose quote is not found word for word in the notes is recorded as unknown). Never infer a basis from the kind of business, from what would be typical, or from anything else, and never choose classes, a package or a discount yourself. Give first_use_date only if a complete date is stated, and a class number only if the notes give that number. Report the package and any discount only as the notes put them. Do not mention the filing basis in the email.`;

/**
 * The firm's own sign-off (Settings → Firm profile, lectual 0078) when it has
 * one, else a placeholder the attorney fills in. Either way the draft waits in
 * the approval queue.
 */
export function followUpSystem(signOff: string | null): string {
  const ending = signOff
    ? `End the email with exactly this sign-off, unchanged:\n<sign_off>\n${signOff}\n</sign_off>`
    : `Sign off with "[Attorney name]" as a placeholder; the attorney edits and sends it.`;
  return `${AGENT_POLICY}\n\n${TASK} ${EXTRACTION_TASK} ${ending}`;
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

/**
 * The agent's two jobs: the follow-up email from the notetaker's consult notes
 * (below), and, for firms that hold the `proposals` module, a proposal + email
 * from a recorded call (`runMeetingProposals`). The second only runs at
 * autonomy draft/act, only with an approval queue, and never changes the first.
 */
export async function runPostConsult(ctx: AgentContext): Promise<AgentResult> {
  const startedAt = ctx.now();
  const notes = await runConsultNotes(ctx);
  if (ctx.autonomy === "suggest" || !ctx.queueOrgKey) return notes;

  let props: AgentResult;
  try {
    props = await runMeetingProposals(ctx, startedAt);
  } catch (err) {
    // The notes path has already queued its drafts; a failure here must not hide that.
    props = { itemsIn: 0, draftsOut: 0, summary: `Proposal drafting from recorded calls failed: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300) };
  }
  if (props.itemsIn === 0 && !props.summary) return notes;
  return {
    itemsIn: notes.itemsIn + props.itemsIn,
    draftsOut: notes.draftsOut + props.draftsOut,
    summary: [notes.summary, props.summary].filter(Boolean).join(" "),
    ...(notes.skipped ? { skipped: true } : {}),
  };
}

/**
 * Recorded calls (Fathom/Zoom, already linked to a lead) from the last
 * LOOKBACK_DAYS that have a summary or transcript, no marker yet, in a firm
 * that holds `proposals` and has set its prices and approvers: each becomes a
 * DRAFT proposal plus one approval-queue email (src/lib/consult-proposal/run.ts).
 * Nothing is sent and nothing is visible to the client; every statement is
 * fenced on the firm's org_id.
 */
async function runMeetingProposals(ctx: AgentContext, startedAt: number): Promise<AgentResult> {
  const none: AgentResult = { itemsIn: 0, draftsOut: 0, summary: "" };
  const { admin, orgId } = ctx;

  // crm_org is keyed by `id` (it IS the org), the one table fenced that way.
  const { data: org, error: orgErr } = await admin.from("crm_org").select("modules").eq("id", orgId).maybeSingle();
  if (orgErr) throw new Error(`org read failed: ${orgErr.message}`);
  if (!((org?.modules as string[] | null | undefined) ?? []).includes("proposals")) return none;

  const { data: setting, error: settingErr } = await admin
    .from("client_proposal_setting")
    .select("approver_user_ids")
    .eq("org_id", orgId)
    .maybeSingle();
  if (settingErr) throw new Error(`proposal settings read failed: ${settingErr.message}`);
  const approvers = (setting?.approver_user_ids as string[] | null | undefined) ?? [];
  if (!setting || approvers.length === 0) return none;

  const origin = ctx.siteOrigin ? await ctx.siteOrigin() : null;
  if (!origin) return { ...none, summary: "No site address is known, so no proposals were drafted from recorded calls." };

  const since = new Date(ctx.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: meetings, error } = await admin
    .from("crm_meeting")
    .select("id, title, started_at, lead_id, matter_id, summary, transcript_first:transcript->0")
    .eq("org_id", orgId)
    .not("lead_id", "is", null)
    .gte("started_at", since)
    // Newest first: a proposal matters most right after the call, and with the
    // oldest first a busy firm's window filled up with calls already drafted.
    .order("started_at", { ascending: false })
    .limit(PROPOSAL_SCAN_LIMIT);
  if (error) throw new Error(`meeting read failed: ${error.message}`);
  const withMaterial = (meetings ?? []).filter((m) => Boolean((m.summary as string | null)?.trim()) || m.transcript_first != null);
  if (withMaterial.length === 0) return none;

  const { data: done, error: doneErr } = await admin
    .from("crm_activity")
    .select("payload")
    .eq("org_id", orgId)
    .in("type", ["queue_drafted", "ai_insight"])
    .eq("payload->>source", CONSULT_PROPOSAL_SOURCE)
    .in("payload->>meeting_id", withMaterial.map((m) => m.id));
  if (doneErr) throw new Error(`activity read failed: ${doneErr.message}`);
  const handled = new Set((done ?? []).map((d) => (d.payload as Record<string, string>).meeting_id));
  const todo = withMaterial.filter((m) => !handled.has(m.id as string)).slice(0, PROPOSAL_MEETING_BATCH);
  if (todo.length === 0) return none;

  let drafted = 0;
  let read = 0;
  let deferred = 0;
  const problems: string[] = [];
  for (const m of todo) {
    if (ctx.now() - startedAt >= PROPOSAL_TIME_BUDGET_MS) {
      deferred = todo.length - read;
      break;
    }
    read += 1;
    const [{ data: lead }, { data: full }] = await Promise.all([
      admin.from("crm_lead").select("id, first_name, last_name, business_name, email").eq("id", m.lead_id as string).eq("org_id", orgId).maybeSingle(),
      admin.from("crm_meeting").select("transcript").eq("id", m.id as string).eq("org_id", orgId).maybeSingle(),
    ]);
    if (!lead) continue;
    const result = await runConsultProposal({
      db: admin,
      admin,
      orgId,
      actorUserId: null,
      source: meetingSource({
        id: m.id as string,
        title: m.title as string | null,
        started_at: m.started_at as string | null,
        summary: m.summary as string | null,
        transcript: full?.transcript ?? null,
      }),
      lead: {
        id: lead.id as string,
        firstName: lead.first_name as string | null,
        lastName: lead.last_name as string | null,
        email: lead.email as string | null,
        businessName: lead.business_name as string | null,
      },
      matterId: (m.matter_id as string | null) ?? null,
      llm: ctx.llm,
      createDraft: ctx.createDraft,
      queueOrgKey: ctx.queueOrgKey,
      origin,
      now: ctx.now,
      skipDecided: true,
    });
    if (result.ok) drafted += 1;
    else if (result.reason !== "no_recommendation" && result.reason !== "not_trademark" && result.reason !== "already_drafted") problems.push(result.reason);
  }

  const parts = [`${drafted} proposal(s) with email drafted for approval from ${read} recorded call(s).`];
  if (problems.length > 0) parts.push(`${problems.length} could not be drafted (${[...new Set(problems)].join(", ")}).`);
  if (deferred > 0) parts.push(`${deferred} left for the next run (time limit).`);
  return { itemsIn: read, draftsOut: drafted, summary: parts.join(" ") };
}

async function runConsultNotes(ctx: AgentContext): Promise<AgentResult> {
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
  const signOff = (profile?.email_signature as string | null | undefined)?.trim() || null;
  const system = followUpSystem(signOff);

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

    // The prompt is also what the extraction is checked against: a basis is kept
    // only if its quoted evidence is really in these notes.
    const prompt = followUpPrompt(lead, (note.notes ?? {}) as ConsultNotes);
    const { output } = await llm({
      system,
      user: prompt,
      schema: FollowUpSchema,
      effort: "high",
      maxTokens: 8000,
      agent: "post-consult",
    });

    const hasRealAddress = lead.email && !lead.email.toLowerCase().endsWith(".invalid");
    const { id: queueId } = await ctx.createDraft({
      orgKey: ctx.queueOrgKey as string,
      agent: "post-consult",
      type: "CLIENT_EMAIL",
      headline: `Post-consult follow-up — ${name}`,
      summary: output.internal_summary,
      clientName: name,
      leadId: lead.id,
      recipient: hasRealAddress ? lead.email : undefined,
      subject: output.subject,
      draftBody: output.body,
      signOff,
    });
    drafted += 1;

    // The draft is already queued, so nothing here may fail the run (a thrown
    // error would skip the activity row below and the note would be drafted
    // again). The extraction goes on the very note this draft came from, fenced
    // by the org that note was read under.
    const detailsSaved = await saveExtraction(admin as unknown as ConsultDb, {
      orgId,
      noteId: note.id as string,
      extraction: output.consult_details,
      source: "post-consult-agent",
      sourceText: prompt,
      now: new Date(ctx.now()),
    });

    const { error: e } = await admin.from("crm_activity").insert({
      org_id: orgId,
      lead_id: lead.id,
      type: "queue_drafted",
      actor_id: null,
      actor_type: "ai",
      payload: { source: "post-consult", consult_note_id: note.id, queue_id: queueId, subject: output.subject, consult_details: detailsSaved },
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
