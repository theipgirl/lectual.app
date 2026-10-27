import type { SupabaseClient } from "@supabase/supabase-js";
import { isDatabaseUpdateNeeded } from "@/lib/calendar/outlook-errors";
import { SENSITIVE_PHRASES } from "@/lib/intake/email-match";
import { NO_FIRM_SENDERS, effectiveDirection, firmSendersFrom, type FirmSenders } from "@/lib/mailbox/firm-sender";
import { moveLeadStageAs } from "@/lib/pipeline/move-as";
import { resolveBatch } from "@/lib/queue/resolve-batch";
import type { QueueItem } from "@/lib/queue/api";
import type { StageOpt } from "@/lib/reconcile/types";
import {
  AGENT_ACTOR,
  REVIEW_SOURCE,
  SUGGESTION_KIND,
  SUGGESTION_SOURCE,
  consumedSignalKeys,
  decidedSuggestionIds,
  parseSuggestion,
  type ActivityRow,
  type SuggestionWhy,
} from "@/lib/stage-keeper/moves";
import { evidenceDateOf, evidenceOf, isSensitiveSignal, signalIdFor, signalKeyFor, type KeeperSignal } from "@/lib/stage-keeper/signals";
import { orgFencedReader } from "../shared";
import type { AgentContext, AgentResult } from "../types";
import { parseStageMapping, type StageMapping } from "./mapping";
import { targetStageFromSignals } from "./target";

/**
 * Stage Keeper: places each lead on the board from facts the firm already recorded.
 *
 * It reads the mail the mailbox sync matched to leads (`email_sent` / `email_received` rows,
 * with their stored type, direction, date, subject and sensitive flag), the Outlook consults
 * linked to leads, the Zoom / Fathom meetings linked to leads (`crm_meeting.lead_id`, never a
 * suggestion) that have taken place, the client proposals whose link is live, and the approved
 * post-consult emails in the approval queue. Inbound mail whose sender is one of the firm's own
 * addresses counts as sent by the firm (a cc into a shared inbox). It works out the furthest-forward stage the signals support
 * (`targetStageFromSignals`, pure) and then:
 *   autonomy `act`             moves the lead (`moveLeadStageAs`, service role, org-fenced)
 *   autonomy `suggest`/`draft` writes a suggestion card (an `ai_insight` row) instead
 * Anything the pure function marks suggest-only (a stage that opens a matter, a closing stage,
 * a welcome or payment signal) is a card in every mode, and a lead a person moved in the last
 * 7 days gets a card instead of a move: a person's placement wins.
 *
 * It is rule-based. It calls no model, queues no draft, sends nothing, and never touches the hot / warm / cold routing a person sets.
 * Each signal is used once: an earlier move OR an earlier suggestion (pending, accepted or
 * dismissed) carrying the same `signal_key` consumes it, so an undone or dismissed signal
 * never comes back. At most one action per lead per run.
 *
 * Every statement carries the firm's `org_id`; the service-role client arrives in the context.
 * Counts only ever leave this file (summary, error): never a name, subject, address or title.
 */

export const SIGNAL_WINDOW_DAYS = 30;
export const PERSON_MOVE_DAYS = 7;
const DAY_MS = 86_400_000;
const MAIL_CAP = 2000;
const EVENT_CAP = 500;
const HISTORY_CAP = 2000;
const CHUNK = 100;
/** Older than any signal that could still be inside the window, plus a margin. */
const HISTORY_DAYS = 45;

type CalendarState = "ok" | "database-update-needed" | "unavailable";

type LeadRow = { id: string; current_stage_id: string };
type StageRow = { id: string; name: string; category: string; order_index: number };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const MEETING_CAP = 500;
const PROPOSAL_CAP = 1000;
const ALSO_KEYS_CAP = 50;

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** True when a calendar title reads like a dispute, the same phrases that mark mail sensitive. */
export function isSensitiveTitle(title: string | null): boolean {
  if (!title) return false;
  const folded = title.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ");
  return SENSITIVE_PHRASES.some((p) => folded.includes(p));
}

// ── reads ────────────────────────────────────────────────────────────────────

async function readStages(admin: SupabaseClient, orgId: string): Promise<StageOpt[]> {
  const { data, error } = await admin.from("crm_stage").select("id, name, category, order_index").eq("org_id", orgId);
  if (error) throw new Error(`stage read failed: ${error.message}`);
  return ((data ?? []) as StageRow[]).map((s) => ({ id: s.id, name: s.name, category: String(s.category), orderIndex: s.order_index }));
}

async function readMapping(admin: SupabaseClient, orgId: string): Promise<StageMapping> {
  const { data, error } = await admin
    .from("crm_firm_brain_entry")
    .select("key, body, data")
    .eq("org_id", orgId)
    .eq("category", "stage_mapping");
  if (error) throw new Error(`firm brain read failed: ${error.message}`);
  return parseStageMapping((data ?? []) as Array<{ key?: unknown; body?: unknown; data?: unknown }>);
}

type MailRead = { signals: Map<string, KeeperSignal[]>; truncated: boolean };

function mailSignal(row: ActivityRow, firm: FirmSenders): { leadId: string; signal: KeeperSignal } | null {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const messageId = text(p.message_id);
  if (!row.lead_id || !messageId) return null;
  const stored = p.direction === "outbound" ? "outbound" : p.direction === "inbound" ? "inbound" : row.type === "email_sent" ? "outbound" : "inbound";
  // Only the sender's address is compared, and it is not kept: a cc'd copy of the firm's own email is the firm's.
  const direction = effectiveDirection(stored, text(p.from), firm);
  return {
    leadId: row.lead_id,
    signal: {
      source: "mail",
      messageId,
      type: text(p.type) ?? "other",
      direction,
      at: text(p.at) ?? row.created_at,
      subject: text(p.subject),
      sensitive: p.sensitive === true,
    },
  };
}

/**
 * The matched mail in the window, newest first up to a cap, PLUS every sensitive message in the
 * window whatever the cap: "sensitive mail never moves anything" must not depend on how busy the
 * inbox was, so those rows are asked for on their own.
 */
async function readMail(admin: SupabaseClient, orgId: string, sinceIso: string, firm: FirmSenders): Promise<MailRead> {
  const base = () =>
    admin
      .from("crm_activity")
      .select("id, lead_id, type, created_at, payload")
      .eq("org_id", orgId)
      .in("type", ["email_sent", "email_received"])
      .eq("payload->>source", "mailbox-sync")
      .not("lead_id", "is", null)
      .gte("created_at", sinceIso);
  const { data, error } = await base().order("created_at", { ascending: false }).limit(MAIL_CAP);
  if (error) throw new Error(`mail read failed: ${error.message}`);
  const { data: flagged, error: flaggedError } = await base().eq("payload->>sensitive", "true").order("created_at", { ascending: false }).limit(MAIL_CAP);
  if (flaggedError) throw new Error(`mail read failed: ${flaggedError.message}`);

  const rows = (data ?? []) as ActivityRow[];
  const signals = new Map<string, KeeperSignal[]>();
  const seen = new Set<string>();
  for (const row of [...rows, ...((flagged ?? []) as ActivityRow[])]) {
    const made = mailSignal(row, firm);
    if (!made || made.signal.source !== "mail") continue;
    const key = `${made.leadId}:${made.signal.messageId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    signals.set(made.leadId, [...(signals.get(made.leadId) ?? []), made.signal]);
  }
  return { signals, truncated: rows.length >= MAIL_CAP };
}

type CalendarRead = { state: CalendarState; signals: Map<string, KeeperSignal[]> };

/** Future Outlook consults linked to a lead. A refused or failed read skips only this half of the input. */
async function readConsults(admin: SupabaseClient, orgId: string, nowIso: string): Promise<CalendarRead> {
  const none = (state: CalendarState): CalendarRead => ({ state, signals: new Map() });
  try {
    const { data, error } = await admin
      .from("crm_calendar_event")
      .select("id, lead_id, title, starts_at")
      .eq("org_id", orgId)
      .eq("source", "outlook")
      .eq("is_consult", true)
      .not("lead_id", "is", null)
      .gte("starts_at", nowIso)
      .order("starts_at", { ascending: true })
      .limit(EVENT_CAP);
    if (error) return none(isDatabaseUpdateNeeded(error) ? "database-update-needed" : "unavailable");
    const signals = new Map<string, KeeperSignal[]>();
    for (const row of (data ?? []) as Array<{ id: string; lead_id: string | null; title: string | null; starts_at: string }>) {
      if (!row.lead_id || !row.starts_at) continue;
      const signal: KeeperSignal = {
        source: "calendar",
        eventId: row.id,
        title: row.title,
        startsAt: row.starts_at,
        sensitive: isSensitiveTitle(row.title),
      };
      signals.set(row.lead_id, [...(signals.get(row.lead_id) ?? []), signal]);
    }
    return { state: "ok", signals };
  } catch {
    return none("unavailable");
  }
}

type FirmRead = { senders: FirmSenders; ok: boolean };

/** The addresses of the firm's own connected mailboxes. A failed read turns the firm-sender rule off for this run and says so. */
async function readFirmSenders(admin: SupabaseClient, orgId: string): Promise<FirmRead> {
  try {
    const { data, error } = await admin.from("mailbox_connection").select("email, status").eq("org_id", orgId);
    if (error) return { senders: NO_FIRM_SENDERS, ok: false };
    const emails = ((data ?? []) as Array<{ email?: unknown; status?: unknown }>)
      .filter((c) => c.status !== "revoked")
      .map((c) => (typeof c.email === "string" ? c.email : null));
    return { senders: firmSendersFrom(emails), ok: true };
  } catch {
    return { senders: NO_FIRM_SENDERS, ok: false };
  }
}

type OptionalRead = { ok: boolean; signals: Map<string, KeeperSignal[]> };

function addSignal(into: Map<string, KeeperSignal[]>, leadId: string, signal: KeeperSignal): void {
  into.set(leadId, [...(into.get(leadId) ?? []), signal]);
}

type MeetingRow = { id: string; lead_id: string | null; provider: string | null; title: string | null; started_at: string | null };

/**
 * Zoom / Fathom meetings linked to a lead (`lead_id`; a `suggested_lead_id` is a guess and never counts)
 * that have taken place: started in the past, or already holding a transcript. The transcript itself is
 * never selected, only whether the column is set. An unreadable table skips this half of the input.
 */
async function readMeetings(admin: SupabaseClient, orgId: string, sinceIso: string, nowIso: string): Promise<OptionalRead> {
  try {
    const columns = "id, lead_id, provider, title, started_at";
    const past = await admin
      .from("crm_meeting")
      .select(columns)
      .eq("org_id", orgId)
      .not("lead_id", "is", null)
      .gte("started_at", sinceIso)
      .lt("started_at", nowIso)
      .order("started_at", { ascending: false })
      .limit(MEETING_CAP);
    if (past.error) return { ok: false, signals: new Map() };
    const transcribed = await admin
      .from("crm_meeting")
      .select(columns)
      .eq("org_id", orgId)
      .not("lead_id", "is", null)
      .not("transcript", "is", null)
      .gte("started_at", sinceIso)
      .order("started_at", { ascending: false })
      .limit(MEETING_CAP);
    if (transcribed.error) return { ok: false, signals: new Map() };

    const signals = new Map<string, KeeperSignal[]>();
    const seen = new Set<string>();
    for (const row of [...((past.data ?? []) as MeetingRow[]), ...((transcribed.data ?? []) as MeetingRow[])]) {
      if (!row.lead_id || !row.started_at || seen.has(row.id)) continue;
      seen.add(row.id);
      addSignal(signals, row.lead_id, {
        source: "meeting",
        meetingId: row.id,
        provider: row.provider === "fathom" ? "fathom" : "zoom",
        title: row.title,
        startsAt: row.started_at,
        sensitive: isSensitiveTitle(row.title),
      });
    }
    return { ok: true, signals };
  } catch {
    return { ok: false, signals: new Map() };
  }
}

type ProposalRow = {
  id: string;
  lead_id: string | null;
  family_id: string | null;
  version: number | null;
  status: string;
  sent_at: string | null;
  accepted_at: string | null;
};

/**
 * Client proposals whose link is live (`sent`) or that the client accepted, one signal per family. A draft,
 * an approved-but-not-live version, a replaced one and a withdrawn one place nobody. Only status, version
 * and dates are selected: not the content, the client's address or the pay link.
 */
async function readProposals(admin: SupabaseClient, orgId: string, sinceMs: number): Promise<OptionalRead> {
  try {
    const { data, error } = await admin
      .from("client_proposal")
      .select("id, lead_id, family_id, version, status, sent_at, accepted_at")
      .eq("org_id", orgId)
      .in("status", ["sent", "accepted"])
      .not("lead_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(PROPOSAL_CAP);
    if (error) return { ok: false, signals: new Map() };

    const newest = new Map<string, { leadId: string; row: ProposalRow; at: string | null; ms: number }>();
    for (const row of (data ?? []) as ProposalRow[]) {
      if (!row.lead_id || (row.status !== "sent" && row.status !== "accepted")) continue;
      const at = row.accepted_at ?? row.sent_at;
      const ms = at ? Date.parse(at) : NaN;
      if (!Number.isFinite(ms) || ms < sinceMs) continue;
      const family = row.family_id ?? row.id;
      const key = `${row.lead_id}:${family}`;
      const have = newest.get(key);
      if (!have || ms > have.ms) newest.set(key, { leadId: row.lead_id, row, at, ms });
    }
    const signals = new Map<string, KeeperSignal[]>();
    for (const { leadId, row, at } of newest.values()) {
      addSignal(signals, leadId, {
        source: "proposal",
        familyId: row.family_id ?? row.id,
        version: typeof row.version === "number" ? row.version : null,
        status: row.status,
        at,
      });
    }
    return { ok: true, signals };
  } catch {
    return { ok: false, signals: new Map() };
  }
}

/** True for the post-consult client email the queue holds (the drafter writes agent `post-consult`, type `CLIENT_EMAIL`). */
function isPostConsultEmail(item: QueueItem): boolean {
  return item.type === "CLIENT_EMAIL" && (item.agent === "post-consult" || /post[- ]consult/i.test(item.headline ?? ""));
}

type QueueRead = OptionalRead & { configured: boolean };

/**
 * Approved post-consult client emails, matched to a lead by the queue's own linking rules (`resolveBatch`),
 * and only when they name exactly ONE lead. A queue that can't be read, or a link lookup that fails, gives no
 * signal and is reported: "none approved" is only ever said about a queue that answered.
 */
async function readApprovedQueue(ctx: AgentContext, sinceMs: number): Promise<QueueRead> {
  if (!ctx.listApproved) return { configured: false, ok: true, signals: new Map() };
  try {
    const approved = (await ctx.listApproved()).filter((item) => {
      if (item.status !== "approved" || !isPostConsultEmail(item)) return false;
      const ms = item.resolved_at ? Date.parse(item.resolved_at) : NaN;
      return Number.isFinite(ms) && ms >= sinceMs;
    });
    const signals = new Map<string, KeeperSignal[]>();
    if (approved.length === 0) return { configured: true, ok: true, signals };
    const resolved = await resolveBatch(orgFencedReader(ctx.admin, ctx.orgId), approved);
    for (const item of approved) {
      const leadIds = resolved.get(item.id)?.leadIds ?? [];
      if (leadIds.length !== 1) continue; // none, or several people: never a guess
      addSignal(signals, leadIds[0], { source: "queue", itemId: item.id, type: item.type, at: item.resolved_at });
    }
    return { configured: true, ok: true, signals };
  } catch {
    return { configured: true, ok: false, signals: new Map() };
  }
}

async function readLeads(admin: SupabaseClient, orgId: string, ids: readonly string[]): Promise<LeadRow[]> {
  const out: LeadRow[] = [];
  for (const batch of chunk(ids, CHUNK)) {
    const { data, error } = await admin.from("crm_lead").select("id, current_stage_id").eq("org_id", orgId).in("id", batch);
    if (error) throw new Error(`lead read failed: ${error.message}`);
    out.push(...((data ?? []) as LeadRow[]));
  }
  return out;
}

type History = {
  consumed: Map<string, Set<string>>;
  /** Newest stage change a person made, per lead. */
  personMovedAt: Map<string, number>;
  /** Stages already waiting on a pending suggestion, per lead. */
  pendingTo: Map<string, Set<string>>;
};

async function readHistory(admin: SupabaseClient, orgId: string, ids: readonly string[], sinceIso: string): Promise<History> {
  const consumed = new Map<string, Set<string>>();
  const personMovedAt = new Map<string, number>();
  const pendingTo = new Map<string, Set<string>>();
  for (const batch of chunk(ids, CHUNK)) {
    const columns = "id, lead_id, type, actor_type, created_at, payload";
    const changes = await admin
      .from("crm_activity")
      .select(columns)
      .eq("org_id", orgId)
      .in("lead_id", batch)
      .eq("type", "stage_changed")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(HISTORY_CAP);
    if (changes.error) throw new Error(`timeline read failed: ${changes.error.message}`);
    // Only this agent's own suggestions and the decisions on them, not every insight other agents wrote.
    const insights = await admin
      .from("crm_activity")
      .select(columns)
      .eq("org_id", orgId)
      .in("lead_id", batch)
      .eq("type", "ai_insight")
      .in("payload->>source", [SUGGESTION_SOURCE, REVIEW_SOURCE])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(HISTORY_CAP);
    if (insights.error) throw new Error(`timeline read failed: ${insights.error.message}`);
    const rows = [...((changes.data ?? []) as ActivityRow[]), ...((insights.data ?? []) as ActivityRow[])];
    // A used signal that fell off a cut-short read would be used again, so a cut-short read stops the run.
    if ((changes.data ?? []).length >= HISTORY_CAP || (insights.data ?? []).length >= HISTORY_CAP) throw new Error("timeline read cut short");

    const decided = decidedSuggestionIds(rows);
    const perLead = new Map<string, ActivityRow[]>();
    for (const row of rows) {
      if (!row.lead_id) continue;
      perLead.set(row.lead_id, [...(perLead.get(row.lead_id) ?? []), row]);
    }
    for (const [leadId, leadRows] of perLead) {
      consumed.set(leadId, consumedSignalKeys(leadRows));
      for (const row of leadRows) {
        const p = (row.payload ?? {}) as Record<string, unknown>;
        // A stage change a person made: signed-in actor, and not the agent's own row.
        if (row.type === "stage_changed" && row.actor_type === "user" && p.actor !== AGENT_ACTOR) {
          const at = Date.parse(row.created_at);
          if (Number.isFinite(at) && at > (personMovedAt.get(leadId) ?? Number.NEGATIVE_INFINITY)) personMovedAt.set(leadId, at);
        }
        const suggestion = parseSuggestion(row);
        if (suggestion?.toStageId && !decided.has(suggestion.activityId)) {
          const set = pendingTo.get(leadId) ?? new Set<string>();
          set.add(suggestion.toStageId);
          pendingTo.set(leadId, set);
        }
      }
    }
  }
  return { consumed, personMovedAt, pendingTo };
}

// ── writes ───────────────────────────────────────────────────────────────────

async function writeSuggestion(
  admin: SupabaseClient,
  orgId: string,
  args: {
    leadId: string;
    from: StageOpt;
    to: StageOpt;
    why: SuggestionWhy;
    signalKey: string;
    alsoSignalKeys: readonly string[];
    signal: KeeperSignal;
    signalId: string;
    autonomy: string;
  },
): Promise<void> {
  const { error } = await admin.from("crm_activity").insert({
    org_id: orgId,
    lead_id: args.leadId,
    type: "ai_insight",
    actor_id: null,
    actor_type: "ai",
    payload: {
      source: SUGGESTION_SOURCE,
      kind: SUGGESTION_KIND,
      signal_key: args.signalKey,
      ...(args.alsoSignalKeys.length > 0 ? { also_signal_keys: [...args.alsoSignalKeys] } : {}),
      signal: args.signalId,
      from_stage_id: args.from.id,
      to_stage_id: args.to.id,
      from_stage: args.from.name,
      to_stage: args.to.name,
      why: args.why,
      evidence: evidenceOf(args.signal),
      autonomy: args.autonomy,
    },
  });
  if (error) throw new Error(`suggestion write failed: ${error.message}`);
}

// ── the run ──────────────────────────────────────────────────────────────────

type Counts = {
  moved: number;
  suggested: number;
  sensitive: number;
  stale: number;
  refused: number;
  duplicate: number;
  failed: number;
};

function summaryOf(leads: number, counts: Counts, extra: string[]): string {
  const parts = [`${leads} lead(s) read: ${counts.moved} moved, ${counts.suggested} suggestion(s) written`];
  if (counts.sensitive) parts.push(`${counts.sensitive} held back as sensitive`);
  if (counts.stale) parts.push(`${counts.stale} changed by a person first`);
  if (counts.refused) parts.push(`${counts.refused} refused`);
  if (counts.duplicate) parts.push(`${counts.duplicate} already waiting`);
  return `${parts.join(", ")}.${extra.length ? ` ${extra.join(" ")}` : ""}`;
}

const CALENDAR_NOTE: Record<Exclude<CalendarState, "ok">, string> = {
  "database-update-needed": "Calendar consults: not available until the database update.",
  unavailable: "Calendar consults couldn't be read this run.",
};

export async function runStageKeeper(ctx: AgentContext): Promise<AgentResult> {
  const { admin, orgId, autonomy } = ctx;
  const nowMs = ctx.now();
  const nowIso = new Date(nowMs).toISOString();
  const notes: string[] = [];

  // Required reads: any failure ends the run as an error before a lead is touched.
  const stages = await readStages(admin, orgId);
  const mapping = await readMapping(admin, orgId);
  const sinceMs = nowMs - SIGNAL_WINDOW_DAYS * DAY_MS;
  const sinceIso = new Date(sinceMs).toISOString();
  const firm = await readFirmSenders(admin, orgId);
  const mail = await readMail(admin, orgId, sinceIso, firm.senders);
  // The calendar half is optional: before lectual 0098 its columns do not exist.
  const calendar = await readConsults(admin, orgId, nowIso);
  if (calendar.state !== "ok") notes.push(CALENDAR_NOTE[calendar.state]);
  // Held meetings, live proposals and approved post-consult emails are optional halves too: each failure is said, never "none".
  const meetings = await readMeetings(admin, orgId, sinceIso, nowIso);
  if (!meetings.ok) notes.push("Linked meetings couldn't be read this run.");
  const proposals = await readProposals(admin, orgId, sinceMs);
  if (!proposals.ok) notes.push("Proposals couldn't be read this run.");
  const queue = await readApprovedQueue(ctx, sinceMs);
  if (!queue.ok) notes.push("Approved post-consult emails couldn't be read this run.");
  if (!firm.ok) notes.push("The firm's mailbox addresses couldn't be read, so mail copied into a shared inbox wasn't counted as sent.");
  if (mail.truncated) notes.push("Mail read cut short; the newest was used.");

  const signalsByLead = new Map<string, KeeperSignal[]>(mail.signals);
  for (const extra of [calendar.signals, meetings.signals, proposals.signals, queue.signals]) {
    for (const [leadId, list] of extra) signalsByLead.set(leadId, [...(signalsByLead.get(leadId) ?? []), ...list]);
  }

  const leadIds = [...signalsByLead.keys()].sort();
  if (leadIds.length === 0) {
    return { itemsIn: 0, draftsOut: 0, summary: `No matched mail or booked consults to place.${notes.length ? ` ${notes.join(" ")}` : ""}` };
  }

  const leads = (await readLeads(admin, orgId, leadIds)).sort((a, b) => (a.id < b.id ? -1 : 1));
  const history = await readHistory(admin, orgId, leadIds, new Date(nowMs - HISTORY_DAYS * DAY_MS).toISOString());
  const stageById = new Map(stages.map((s) => [s.id, s]));
  const counts: Counts = { moved: 0, suggested: 0, sensitive: 0, stale: 0, refused: 0, duplicate: 0, failed: 0 };

  for (const lead of leads) {
    const consumed = history.consumed.get(lead.id) ?? new Set<string>();
    const all = signalsByLead.get(lead.id) ?? [];
    // Sensitive facts always count, even ones an earlier run already looked at.
    const live = all.filter((s) => isSensitiveSignal(s) || !consumed.has(signalKeyFor(lead.id, s)));
    const target = targetStageFromSignals({ currentStageId: lead.current_stage_id }, live, stages, mapping, { now: nowMs });

    if (target.kind === "nothing") {
      // Counted only when the lead had something that would have placed it: a sensitive message on its own is just a note.
      if (target.reason === "sensitive" && live.some((s) => signalIdFor(s) !== null)) counts.sensitive += 1;
      continue;
    }

    const from = stageById.get(lead.current_stage_id);
    if (!from) continue;
    const signalKey = signalKeyFor(lead.id, target.signal);
    const alsoSignalKeys = [...new Set(target.covered.map((c) => signalKeyFor(lead.id, c)))].filter((k) => k !== signalKey).slice(0, ALSO_KEYS_CAP);

    let suggestWhy: SuggestionWhy | null = null;
    if (target.kind === "suggest") suggestWhy = target.why;
    else if (autonomy !== "act") suggestWhy = "autonomy";
    else {
      const personAt = history.personMovedAt.get(lead.id);
      if (personAt !== undefined && nowMs - personAt <= PERSON_MOVE_DAYS * DAY_MS) suggestWhy = "recent-person-move";
    }

    if (suggestWhy) {
      if (history.pendingTo.get(lead.id)?.has(target.stage.id)) {
        counts.duplicate += 1;
        continue;
      }
      await writeSuggestion(admin, orgId, {
        leadId: lead.id,
        from,
        to: target.stage,
        why: suggestWhy,
        signalKey,
        alsoSignalKeys,
        signal: target.signal,
        signalId: target.signalId,
        autonomy,
      });
      counts.suggested += 1;
      continue;
    }

    const outcome = await moveLeadStageAs(
      { kind: "agent", agent: "stage-keeper", admin, orgId },
      {
        leadId: lead.id,
        fromStageId: from.id,
        toStageId: target.stage.id,
        signalKey,
        alsoSignalKeys,
        signalId: target.signalId,
        evidence: evidenceOf(target.signal),
        evidenceAt: evidenceDateOf(target.signal),
        now: nowMs,
      },
    );
    if (outcome.ok) counts.moved += 1;
    else if (outcome.reason === "stale" || outcome.reason === "not-found") counts.stale += 1;
    else if (outcome.reason === "refused") counts.refused += 1;
    else counts.failed += 1;
  }

  const summary = summaryOf(leads.length, counts, notes);
  // A failed write is an error run (counts only), never a quiet "ok".
  if (counts.failed > 0) throw new Error(`${counts.failed} lead move(s) failed. ${summary}`);
  return { itemsIn: counts.moved + counts.suggested, draftsOut: counts.suggested, summary };
}
