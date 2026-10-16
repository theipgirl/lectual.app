import { z } from "zod";
import { AGENT_POLICY } from "./policy";
import type { AgentContext, AgentResult } from "./types";
import { fetchMessageBody } from "@/lib/mailbox/fetch";
import { freshAccessToken, type ConnectionRow } from "@/lib/mailbox/sync";
import type { MailboxProvider } from "@/lib/mailbox/providers";

/**
 * Email → client intel: reads inbound mail the sync has ALREADY filed on a
 * lead, and pulls out what the lead record is missing.
 *
 * Privacy, in order of how much it matters:
 *   · Only messages matched to a lead are ever read. The body is fetched from
 *     the provider for this one call, sent to the model, and discarded — it is
 *     never written anywhere.
 *   · A message the sync classified as sensitive (opposing counsel, a
 *     complaint, a dispute) is skipped entirely.
 *   · What is stored is the proposal: field, value, and a short quote as
 *     evidence, on an `ai_insight` timeline entry.
 *
 * By autonomy level: suggest/draft record the proposal only; act also fills
 * the proposed fields that are still EMPTY on the lead. A value a person
 * entered is never overwritten, whatever the email says.
 *
 * A client asking a legal question becomes a BRIEFING for the attorney
 * (when the firm has a queue) — the agent never answers it.
 */

export const INTEL_BATCH = 25;
const LOOKBACK_DAYS = 7;

export const INTEL_FIELDS = ["business_name", "phone", "website", "mark_text", "practice_area"] as const;
export type IntelField = (typeof INTEL_FIELDS)[number];

export const IntelSchema = z.object({
  changes: z
    .array(
      z.object({
        field: z.enum(INTEL_FIELDS),
        value: z.string().describe("The value exactly as the client gave it"),
        evidence: z.string().describe("A short quote from the email that supports it (under 200 characters)"),
      }),
    )
    .describe("Only facts the email states about the client themselves; empty if none"),
  summary: z.string().describe("One sentence on what the email is about, for the timeline"),
  legal_question: z
    .string()
    .nullable()
    .describe("If the client asks the firm a legal question, restate it in one sentence; otherwise null"),
});
export type Intel = z.infer<typeof IntelSchema>;

const SYSTEM = `${AGENT_POLICY}

Your job: read one email from a prospective client to the firm and extract facts about the client that belong on their record: business name, phone number, website, the trademark/brand name they want protected (mark_text), and practice area (for example "Trademark", "Copyright"). Only record what the email itself states about the sender or their business. Quote the evidence. If they ask a legal question, restate it for the attorney; do not answer it.`;

type LeadRow = Record<IntelField, string | null> & { id: string; first_name: string; last_name: string };

/** Which proposed changes may be written: only into fields that are empty. Pure. */
export function fillOnly(lead: Partial<Record<IntelField, string | null>>, changes: Intel["changes"]): Partial<Record<IntelField, string>> {
  const out: Partial<Record<IntelField, string>> = {};
  for (const c of changes) {
    const current = lead[c.field];
    const value = c.value.trim();
    if (!value || value.length > 300) continue;
    if (current && current.trim()) continue; // a person's value stands
    if (out[c.field]) continue; // first proposal for a field wins
    out[c.field] = value;
  }
  return out;
}

export function intelPrompt(lead: LeadRow, email: { from: string | null; subject: string | null; at: string | null; body: string }): string {
  const known = INTEL_FIELDS.map((f) => `${f}: ${lead[f] ?? "(empty)"}`).join("\n");
  return [
    `Lead on file: ${`${lead.first_name} ${lead.last_name}`.trim()}`,
    `What the record already says:\n${known}`,
    "",
    `<email from="${email.from ?? "unknown"}" date="${email.at ?? "unknown"}">`,
    `Subject: ${email.subject ?? "(none)"}`,
    "",
    email.body,
    "</email>",
  ].join("\n");
}

export async function runEmailIntel(ctx: AgentContext): Promise<AgentResult> {
  const { admin, orgId, autonomy, llm } = ctx;
  if (!ctx.mailbox) return { itemsIn: 0, draftsOut: 0, summary: "Mailbox access isn't configured.", skipped: true };

  const since = new Date(ctx.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: acts, error } = await admin
    .from("crm_activity")
    .select("id, lead_id, payload, created_at")
    .eq("org_id", orgId)
    .eq("type", "email_received")
    .eq("payload->>source", "mailbox-sync")
    .not("lead_id", "is", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(INTEL_BATCH * 2);
  if (error) throw new Error(`activity read failed: ${error.message}`);

  const candidates = (acts ?? []).filter((a) => {
    const p = (a.payload ?? {}) as Record<string, unknown>;
    return typeof p.message_id === "string" && typeof p.connection_id === "string" && p.sensitive !== true;
  });
  if (candidates.length === 0) return { itemsIn: 0, draftsOut: 0, summary: "No new client email to read." };

  // Already processed?  One ai_insight per message, keyed by message_id.
  const ids = candidates.map((a) => (a.payload as Record<string, string>).message_id);
  const { data: done, error: doneErr } = await admin
    .from("crm_activity")
    .select("payload")
    .eq("org_id", orgId)
    .eq("type", "ai_insight")
    .eq("payload->>source", "email-intel")
    .in("payload->>message_id", ids);
  if (doneErr) throw new Error(`activity read failed: ${doneErr.message}`);
  const processed = new Set((done ?? []).map((d) => (d.payload as Record<string, string>).message_id));
  const todo = candidates.filter((a) => !processed.has((a.payload as Record<string, string>).message_id)).slice(0, INTEL_BATCH);

  const tokens = new Map<string, { row: ConnectionRow; accessToken: string } | null>();
  let read = 0;
  let applied = 0;
  let drafts = 0;

  for (const act of todo) {
    const p = act.payload as Record<string, string | null>;
    const connectionId = p.connection_id as string;

    if (!tokens.has(connectionId)) {
      const { data: row } = await admin
        .from("mailbox_connection")
        .select("id, org_id, provider, email, status, access_token_enc, refresh_token_enc, token_expires_at, sync_cursor, matched_count")
        .eq("id", connectionId)
        .eq("org_id", orgId)
        .maybeSingle();
      if (!row || (row as ConnectionRow).status !== "active") {
        tokens.set(connectionId, null);
      } else {
        try {
          tokens.set(connectionId, { row: row as ConnectionRow, accessToken: await freshAccessToken(ctx.mailbox, row as ConnectionRow) });
        } catch {
          tokens.set(connectionId, null); // the sync will mark it for reconnection
        }
      }
    }
    const conn = tokens.get(connectionId);
    if (!conn) continue;

    const body = await fetchMessageBody(conn.row.provider as MailboxProvider, {
      accessToken: conn.accessToken,
      messageId: p.message_id as string,
      fetchImpl: ctx.fetchImpl,
    });
    if (!body) continue;

    const { data: lead } = await admin
      .from("crm_lead")
      .select("id, first_name, last_name, business_name, phone, website, mark_text, practice_area")
      .eq("id", act.lead_id as string)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!lead) continue;
    read += 1;

    const { output } = await llm({
      system: SYSTEM,
      user: intelPrompt(lead as LeadRow, { from: p.from, subject: p.subject, at: p.at, body }),
      schema: IntelSchema,
      effort: "medium",
      maxTokens: 4000,
    });

    const writable = autonomy === "act" ? fillOnly(lead as LeadRow, output.changes) : {};
    if (Object.keys(writable).length > 0) {
      const { error: upErr } = await admin.from("crm_lead").update(writable).eq("id", lead.id).eq("org_id", orgId);
      if (upErr) throw new Error(`lead update failed: ${upErr.message}`);
      applied += 1;
    }

    const { error: insErr } = await admin.from("crm_activity").insert({
      org_id: orgId,
      lead_id: lead.id,
      type: "ai_insight",
      actor_id: null,
      actor_type: "ai",
      payload: {
        source: "email-intel",
        message_id: p.message_id,
        autonomy,
        summary: output.summary,
        proposed: output.changes.map((c) => ({ field: c.field, value: c.value, evidence: c.evidence.slice(0, 200) })),
        applied: Object.keys(writable),
        legal_question: output.legal_question,
      },
    });
    if (insErr) throw new Error(`activity insert failed: ${insErr.message}`);

    if (output.legal_question && ctx.queueOrgKey) {
      const name = `${lead.first_name} ${lead.last_name}`.trim();
      await ctx.createDraft({
        orgKey: ctx.queueOrgKey,
        agent: "email-intel",
        type: "BRIEFING",
        headline: `${name || "A lead"} asked a legal question`,
        clientName: name || undefined,
        summary: output.legal_question,
        draftBody: `${name || "The client"} asked, by email: ${output.legal_question}\n\nThis needs an attorney's answer. Lectual has not replied.`,
      });
      drafts += 1;
    }
  }

  return {
    itemsIn: read,
    draftsOut: drafts,
    summary: read === 0 ? "No new client email to read." : `${read} email(s) read, ${applied} record(s) filled in.`,
  };
}
