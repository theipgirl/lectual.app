import { z } from "zod";
import { classifyEmail } from "@/lib/intake/email-match";
import { assertNoJudgmentContent } from "@/lib/prep-consult/prep-consult";
import { resolveBatch } from "@/lib/queue/resolve-batch";
import { AGENT_POLICY } from "../policy";
import { DAY_MS, chunk, failureCategory, leadLabel, oneLine, orgFencedReader, realAddress, signOffRule } from "../shared";
import type { AgentContext } from "../types";
import { FOLLOW_UP_CAP, FOLLOW_UP_COOLDOWN_DAYS, type StalledLead } from "./rules";
import type { QueueRead } from "./sections";

/**
 * The stalled-lead follow-ups: one CLIENT_EMAIL draft per stalled lead, at most FOLLOW_UP_CAP a run.
 *
 * A lead gets none when:
 *   - it has no real address (a placeholder or `.invalid` one is not a person's inbox);
 *   - a draft for it is already pending. "For it" is decided by the repo's three linking rules, in
 *     their order, through the SAME resolver the lead pages use (`resolveBatch`), then by a
 *     case-insensitive match of the queue row's client name (an extra exclusion that can only block);
 *   - it has a sensitive recent thread (opposing counsel, litigation, a dispute...);
 *   - the agent drafted a follow-up for it in the last FOLLOW_UP_COOLDOWN_DAYS days.
 * And NONE are drafted when the pending queue or a link lookup could not be read: the agent cannot
 * show that no draft is waiting, so it drafts nothing (fail closed) and says why.
 */

const MAIL_LOOKBACK_DAYS = 30;
const BATCH = 10;
const ROW_CAP = 2000;

export const FOLLOW_UP_SOURCE = "morning-brief";
export const FOLLOW_UP_KIND = "stalled_follow_up";

export type Skips = { noAddress: number; pendingDraft: number; sensitive: number; recent: number };

export type FollowUpPlan = { ok: true; chosen: StalledLead[]; skips: Skips } | { ok: false; reason: string };

const fold = (s: string | null | undefined): string => (s ?? "").normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

export async function planFollowUps(ctx: AgentContext, stalled: readonly StalledLead[], pending: QueueRead): Promise<FollowUpPlan> {
  const skips: Skips = { noAddress: 0, pendingDraft: 0, sensitive: 0, recent: 0 };
  if (stalled.length === 0) return { ok: true, chosen: [], skips };
  if (pending.state !== "ok") {
    return { ok: false, reason: "the approval queue couldn't be read, so it can't be shown that no draft is already waiting for these leads" };
  }

  const { admin, orgId } = ctx;
  // Which leads already have a draft waiting: the three linking rules, then the client name.
  const linked = new Set<string>();
  if (pending.items.length > 0) {
    try {
      const resolved = await resolveBatch(orgFencedReader(admin, orgId), pending.items);
      for (const hit of resolved.values()) for (const id of hit.leadIds) linked.add(id);
    } catch {
      return { ok: false, reason: "the lookup that links waiting drafts to leads failed, so it can't be shown that no draft is already waiting" };
    }
  }
  const waitingNames = new Set(pending.items.map((i) => fold(i.client_name)).filter(Boolean));

  const eligible: StalledLead[] = [];
  for (const item of stalled) {
    if (!realAddress(item.lead.email)) {
      skips.noAddress += 1;
      continue;
    }
    const names = [fold(leadLabel(item.lead, "")), fold(item.lead.business_name)].filter(Boolean);
    if (linked.has(item.lead.id) || names.some((n) => waitingNames.has(n))) {
      skips.pendingDraft += 1;
      continue;
    }
    eligible.push(item);
  }

  const chosen: StalledLead[] = [];
  for (const batch of chunk(eligible, BATCH)) {
    if (chosen.length >= FOLLOW_UP_CAP) break;
    const ids = batch.map((b) => b.lead.id);
    let sensitive: Set<string>;
    let recent: Set<string>;
    try {
      sensitive = await sensitiveThreads(ctx, ids);
      recent = await recentFollowUps(ctx, ids);
    } catch {
      return { ok: false, reason: "a check on recent mail or earlier follow-ups failed, so no follow-ups were drafted" };
    }
    for (const item of batch) {
      if (chosen.length >= FOLLOW_UP_CAP) break;
      if (sensitive.has(item.lead.id)) skips.sensitive += 1;
      else if (recent.has(item.lead.id)) skips.recent += 1;
      else chosen.push(item);
    }
  }
  return { ok: true, chosen, skips };
}

/** Leads with a sensitive thread in the recent mail the sync filed on them. Throws if the read fails or is cut short. */
async function sensitiveThreads(ctx: AgentContext, leadIds: readonly string[]): Promise<Set<string>> {
  const since = new Date(ctx.now() - MAIL_LOOKBACK_DAYS * DAY_MS).toISOString();
  const { data, error } = await ctx.admin
    .from("crm_activity")
    .select("lead_id, payload")
    .eq("org_id", ctx.orgId)
    .in("lead_id", leadIds)
    .in("type", ["email_sent", "email_received"])
    .gte("created_at", since)
    .limit(ROW_CAP);
  if (error) throw new Error("mail history read failed");
  const rows = (data ?? []) as Array<{ lead_id: string | null; payload: Record<string, unknown> | null }>;
  if (rows.length >= ROW_CAP) throw new Error("mail history read cut short");
  const out = new Set<string>();
  for (const row of rows) {
    if (!row.lead_id) continue;
    const p = row.payload ?? {};
    const subject = typeof p.subject === "string" ? p.subject : null;
    if (p.sensitive === true || classifyEmail(subject, "").sensitive) out.add(row.lead_id);
  }
  return out;
}

/** Leads this agent already drafted a follow-up for inside the cooldown. Throws if the read fails. */
async function recentFollowUps(ctx: AgentContext, leadIds: readonly string[]): Promise<Set<string>> {
  const since = new Date(ctx.now() - FOLLOW_UP_COOLDOWN_DAYS * DAY_MS).toISOString();
  const { data, error } = await ctx.admin
    .from("crm_activity")
    .select("lead_id")
    .eq("org_id", ctx.orgId)
    .in("lead_id", leadIds)
    .eq("type", "queue_drafted")
    .eq("payload->>source", FOLLOW_UP_SOURCE)
    .eq("payload->>kind", FOLLOW_UP_KIND)
    .gte("created_at", since);
  if (error) throw new Error("follow-up history read failed");
  return new Set(((data ?? []) as Array<{ lead_id: string | null }>).map((r) => r.lead_id).filter((id): id is string => Boolean(id)));
}

// ── the draft ────────────────────────────────────────────────────────────────

export const FollowUpSchema = z.object({
  subject: z.string().describe("Email subject line"),
  body: z.string().describe("Plain-text email from the attorney to the prospective client. Short, warm, ends with one clear next step."),
  internal_summary: z.string().describe("One or two sentences for the attorney reviewing the draft: why this lead was picked and what to check"),
});

const TASK = `Your job: draft a short follow-up email from an IP attorney to a prospective client who has gone quiet. Use only the lead record you are given. Check in warmly, say the firm is glad to help when they are ready, and offer one clear next step (a reply, or a time to talk). Do not give legal advice, do not mention any price, fee, package, class or deadline, and do not promise an outcome. Do not claim anything about the client that the record does not say.`;

export function followUpSystem(signOff: string | null): string {
  return `${AGENT_POLICY}\n\n${TASK} ${signOffRule(signOff)}`;
}

export function followUpPrompt(item: StalledLead): string {
  const { lead, stage } = item;
  return [
    "<lead_record>",
    `First name: ${oneLine(lead.first_name, 80) || "(unknown)"}`,
    `Business: ${oneLine(lead.business_name, 200) || "(not given)"}`,
    `Practice area: ${oneLine(lead.practice_area, 120) || "(not given)"}`,
    `Current stage: ${oneLine(stage.name, 120)}`,
    `Days since the last contact: ${item.idleDays}`,
    "</lead_record>",
  ].join("\n");
}

export type FollowUpOutcome = { ok: true; queueId: string; recorded: boolean } | { ok: false; reason: string };

/** Drafts and queues one follow-up. A failure here costs this lead's draft only. */
export async function draftFollowUp(ctx: AgentContext, item: StalledLead, signOff: string | null): Promise<FollowUpOutcome> {
  const recipient = realAddress(item.lead.email);
  if (!recipient || !ctx.queueOrgKey) return { ok: false, reason: "no address" };
  const name = leadLabel(item.lead);
  try {
    const { output } = await ctx.llm({
      system: followUpSystem(signOff),
      user: followUpPrompt(item),
      schema: FollowUpSchema,
      effort: "medium",
      maxTokens: 2000,
    });
    // A follow-up that names a price, a class or a package is attorney judgment: it is refused, not queued.
    assertNoJudgmentContent(`${output.subject}\n${output.body}`, "follow-up email");
    const { id } = await ctx.createDraft({
      orgKey: ctx.queueOrgKey,
      agent: "morning-brief",
      type: "CLIENT_EMAIL",
      headline: `Follow-up for a stalled lead: ${name}`,
      summary: output.internal_summary,
      clientName: name,
      leadId: item.lead.id,
      recipient,
      subject: output.subject,
      draftBody: output.body,
      signOff,
    });
    // The queue item exists now. This row is what the lead pages and the cooldown find it by; if it
    // cannot be written the draft stands and the run says so.
    const { error } = await ctx.admin.from("crm_activity").insert({
      org_id: ctx.orgId,
      lead_id: item.lead.id,
      type: "queue_drafted",
      actor_id: null,
      actor_type: "ai",
      payload: { source: FOLLOW_UP_SOURCE, kind: FOLLOW_UP_KIND, queueItemId: id },
    });
    return { ok: true, queueId: id, recorded: !error };
  } catch (err) {
    return { ok: false, reason: failureCategory(err) };
  }
}
