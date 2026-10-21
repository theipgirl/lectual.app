import { dedupeByConversation, firmDomainsOf, triageMessage, type Bucket } from "@/lib/inbox/triage";
import { fetchNewMessages } from "@/lib/mailbox/fetch";
import { ProviderError, type MailboxProvider } from "@/lib/mailbox/providers";
import { freshAccessToken, type ConnectionRow } from "@/lib/mailbox/sync";
import type { ThreadMessage } from "@/lib/intake/email-threads";
import { MAILBOX_GATE_REASON, mailboxModuleState } from "../mailbox-gate";
import { IN_CHUNK, chunk, readFirmStyle } from "../shared";
import type { AgentContext, AgentResult } from "../types";
import { renderDigest, type DigestItem } from "./digest";
import { createReplyDrafts, replyEligibility, type ReplyCandidate, type ReplyReason } from "./reply";

/**
 * Inbox summary: reads the last 24 hours of INBOUND mail in the firm's connected mailboxes, sorts it
 * with the deterministic triage rules (approve / needs-you / route / scam / fyi / low), writes ONE
 * BRIEFING digest into the approval queue, and, for needs-you mail in a personal Outlook mailbox,
 * leaves a reply draft in that mailbox's Drafts folder. It only drafts: nothing is sent, nothing is
 * filed, no mail is marked read.
 *
 * Metadata only: headers and the provider's own short preview are used in memory to triage and then
 * dropped; none is stored. A body is fetched for a message only when it will get a reply draft, goes
 * to the model, and is discarded. The window read never touches a connection's `sync_cursor`.
 *
 * It reads mailboxes, so the Mailboxes module is checked first on every run: with the module off (or
 * unreadable) the run ends skipped before ANY provider request is made. A connection that needs
 * reconnecting is listed in the digest; the others still run; if every connection failed the run fails.
 *
 * Counts only ever leave this file (the summary, an error): never an address, subject or name.
 */

export const WINDOW_HOURS = 24;
/** Most messages read from one mailbox. The newest are kept. */
export const MAILBOX_CAP = 200;

type Row = ConnectionRow & { scope: string };

type ReadMessage = ThreadMessage & { connection: { id: string; email: string; scope: string; provider: MailboxProvider } };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function skipped(summary: string): AgentResult {
  return { itemsIn: 0, draftsOut: 0, summary, skipped: true };
}

/** A connection failure as the digest words it: a category, never the provider's message. */
function connectionReason(err: unknown): string {
  return err instanceof ProviderError && err.code === "reauth" ? "needs reconnecting" : "couldn't be read";
}

export async function runInboxSummary(ctx: AgentContext): Promise<AgentResult> {
  const { admin, orgId, autonomy } = ctx;
  // Before anything else, and before any provider request: modules fail closed.
  const gate = mailboxModuleState(ctx);
  if (gate !== "on") return skipped(`Skipped: ${MAILBOX_GATE_REASON[gate]}.`);
  if (!ctx.queueOrgKey) return skipped("No approval queue is connected for this firm, so no digest was written.");
  if (!ctx.mailbox) return skipped("Mailbox access isn't configured.");
  const mailbox = ctx.mailbox;

  const { data, error } = await admin
    .from("mailbox_connection")
    .select("id, org_id, provider, email, scope, status, access_token_enc, refresh_token_enc, token_expires_at, sync_cursor, matched_count, scopes")
    .eq("org_id", orgId);
  if (error) throw new Error("The mailbox connections could not be read.");
  const rows = ((data ?? []) as Row[]).filter((r) => r.org_id === orgId);
  const active = rows.filter((r) => r.status === "active");
  const broken = rows.filter((r) => r.status === "reauth" || r.status === "error");
  if (active.length === 0 && broken.length === 0) return skipped("No active mailbox is connected, so there was no mail to read.");

  const nowMs = ctx.now();
  const since = nowMs - WINDOW_HOURS * 3_600_000;
  const style = await readFirmStyle(admin, orgId);

  // One access token per connection, fetched on demand and remembered.
  const tokens = new Map<string, Promise<string>>();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const accessTokenFor = (id: string): Promise<string> => {
    let p = tokens.get(id);
    if (!p) {
      const row = byId.get(id);
      p = row ? freshAccessToken(mailbox, row) : Promise.reject(new Error("unknown connection"));
      tokens.set(id, p);
    }
    return p;
  };

  // ── read: personal mailboxes first, so a thread cc'd to several is kept as the personal copy ──
  const ordered = [...active].sort((a, b) => Number(b.scope === "personal") - Number(a.scope === "personal") || a.email.localeCompare(b.email));
  const unreadable = broken.map((r) => ({ email: r.email, reason: r.status === "reauth" ? "needs reconnecting" : "couldn't be read on its last sync" }));
  const read: ReadMessage[] = [];
  let cutShort = 0;
  let mailboxesRead = 0;
  for (const row of ordered) {
    try {
      const accessToken = await accessTokenFor(row.id);
      const fetched = await fetchNewMessages(row.provider, {
        accessToken,
        mailbox: row.email,
        cursor: null,
        fetchImpl: ctx.fetchImpl,
        now: nowMs,
        maxMessages: MAILBOX_CAP,
        window: { hours: WINDOW_HOURS },
      });
      const fresh = fetched.messages
        .filter((m) => m.direction === "inbound" && (m.at === null || Date.parse(m.at) >= since))
        .sort((a, b) => Date.parse(b.at ?? "") - Date.parse(a.at ?? "") || 0);
      if (fetched.truncated || fresh.length > MAILBOX_CAP) cutShort += 1;
      for (const m of fresh.slice(0, MAILBOX_CAP)) read.push({ ...m, connection: { id: row.id, email: row.email, scope: row.scope, provider: row.provider } });
      mailboxesRead += 1;
    } catch (err) {
      unreadable.push({ email: row.email, reason: connectionReason(err) });
    }
  }
  if (mailboxesRead === 0) throw new Error("The inbox summary could not be written: none of the connected mailboxes could be read.");

  // ── which messages are already filed on a lead or matter (the sync's own rows) ──
  const filed = new Map<string, { leadId: string | null }>();
  let matchLookupFailed = false;
  try {
    for (const batch of chunk(read.map((m) => m.id), IN_CHUNK)) {
      const res = await admin
        .from("crm_activity")
        .select("lead_id, matter_id, payload")
        .eq("org_id", orgId)
        .in("type", ["email_sent", "email_received"])
        .in("payload->>message_id", batch);
      if (res.error) throw new Error("match lookup failed");
      for (const row of (res.data ?? []) as Array<{ lead_id: string | null; matter_id: string | null; payload: Record<string, unknown> | null }>) {
        const id = row.payload?.message_id;
        if (typeof id === "string" && (row.lead_id || row.matter_id)) filed.set(id, { leadId: row.lead_id ?? null });
      }
    }
  } catch {
    matchLookupFailed = true;
    filed.clear();
  }
  const leadNames = new Map<string, string>();
  const filedLeadIds = [...new Set([...filed.values()].map((f) => f.leadId).filter((id): id is string => Boolean(id)))];
  if (filedLeadIds.length > 0) {
    try {
      for (const batch of chunk(filedLeadIds, IN_CHUNK)) {
        const res = await admin.from("crm_lead").select("id, first_name, last_name, business_name").eq("org_id", orgId).in("id", batch);
        if (res.error) throw new Error("lead name lookup failed");
        for (const l of (res.data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; business_name: string | null }>) {
          leadNames.set(l.id, `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || l.business_name?.trim() || "a lead");
        }
      }
    } catch {
      matchLookupFailed = true;
    }
  }

  // ── triage, then one row per conversation ──
  const firmDomains = firmDomainsOf(rows.map((r) => r.email));
  const conversationOf = new Map<string, string | null>();
  const triaged = read.map((m) => {
    conversationOf.set(m.id, m.conversationId);
    const t = triageMessage(
      {
        id: m.id,
        mailbox: m.mailbox,
        fromName: m.from.name,
        fromAddress: m.from.address,
        subject: m.subject,
        preview: m.preview,
        receivedDateTime: m.at,
        webLink: m.webLink,
      },
      { firmDomains },
    );
    return { ...t, connection: m.connection };
  });
  const unique = dedupeByConversation(triaged, (m) => conversationOf.get(m.id) ?? null).sort((a, b) => Date.parse(b.receivedAt ?? "") - Date.parse(a.receivedAt ?? "") || 0);

  // ── reply drafts (needs-you, personal Outlook, newest first) ──
  const needsYou = unique.filter((m) => m.bucket === "needs-you");
  const replyOff = autonomy === "suggest";
  const replyRun = replyOff
    ? null
    : await createReplyDrafts(ctx, { accessTokenFor, signOff: style.signOff, candidates: needsYou as ReplyCandidate[] });

  const items: DigestItem[] = unique.map((m) => {
    const hit = filed.get(m.id);
    let reply: DigestItem["reply"] = null;
    if (m.bucket === "needs-you" && replyRun) {
      reply = replyRun.drafted.has(m.id) ? { drafted: true } : { drafted: false, reason: replyRun.notDrafted.get(m.id) ?? replyEligibility(m) ?? "error" };
    } else if (m.bucket === "needs-you") {
      reply = { drafted: false, reason: replyEligibility(m) ?? "suggest" };
    }
    return { ...m, matchedLead: hit?.leadId ? (leadNames.get(hit.leadId) ?? "a lead") : null, matchedMatter: Boolean(hit && !hit.leadId), reply };
  });

  const failureReasons: ReplyReason[] = ["reconnect", "drafts-unreadable", "no-body", "model", "judgment", "error"];
  const failures = replyRun ? failureReasons.map((reason) => ({ reason, count: replyRun.counts[reason] })).filter((f) => f.count > 0) : [];
  const created = replyRun ? replyRun.drafted.size : 0;

  const digest = renderDigest({
    nowMs,
    tz: style.timeZone,
    windowHours: WINDOW_HOURS,
    items,
    mailboxesRead,
    unreadable,
    cutShort,
    matchLookupFailed,
    replies: { created, failures, off: replyOff },
  });
  await ctx.createDraft({
    orgKey: ctx.queueOrgKey,
    agent: "inbox-summary",
    type: "BRIEFING",
    headline: digest.headline,
    summary: digest.summary,
    draftBody: digest.body,
  });

  const count = (b: Bucket) => items.filter((i) => i.bucket === b).length;
  const parts = [
    `${plural(items.length, "message", "messages")} sorted from ${plural(mailboxesRead, "mailbox", "mailboxes")} (approve ${count("approve")}, needs you ${count("needs-you")}, route ${count("route")}, scam ${count("scam")}, fyi ${count("fyi")}, low ${count("low")}).`,
  ];
  if (replyOff) parts.push("Reply drafts are off at the suggest level.");
  else parts.push(`${plural(created, "reply draft", "reply drafts")} created in Outlook.`);
  const failedCount = failures.reduce((n, f) => n + f.count, 0);
  if (failedCount > 0) parts.push(`${plural(failedCount, "reply draft", "reply drafts")} could not be created.`);
  if (unreadable.length > 0) parts.push(`${plural(unreadable.length, "mailbox", "mailboxes")} could not be read.`);
  if (matchLookupFailed) parts.push("Which messages are filed on a lead could not be checked.");

  return { itemsIn: items.length, draftsOut: 1 + created, summary: parts.join(" ") };
}
