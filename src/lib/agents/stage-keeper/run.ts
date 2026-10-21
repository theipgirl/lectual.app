import type { SupabaseClient } from "@supabase/supabase-js";
import { isDatabaseUpdateNeeded } from "@/lib/calendar/outlook-errors";
import { SENSITIVE_PHRASES } from "@/lib/intake/email-match";
import { moveLeadStageAs } from "@/lib/pipeline/move-as";
import type { StageOpt } from "@/lib/reconcile/types";
import {
  AGENT_ACTOR,
  SUGGESTION_KIND,
  SUGGESTION_SOURCE,
  consumedSignalKeys,
  decidedSuggestionIds,
  parseSuggestion,
  type ActivityRow,
  type SuggestionWhy,
} from "@/lib/stage-keeper/moves";
import { evidenceDateOf, evidenceOf, signalKeyFor, type KeeperSignal } from "@/lib/stage-keeper/signals";
import type { AgentContext, AgentResult } from "../types";
import { parseStageMapping, type StageMapping } from "./mapping";
import { targetStageFromSignals } from "./target";

/**
 * Stage Keeper: places each lead on the board from facts the firm already recorded.
 *
 * It reads the mail the mailbox sync matched to leads (`email_sent` / `email_received` rows,
 * with their stored type, direction, date, subject and sensitive flag) and the Outlook consults
 * linked to leads, works out the furthest-forward stage the signals support
 * (`targetStageFromSignals`, pure) and then:
 *   autonomy `act`             moves the lead (`moveLeadStageAs`, service role, org-fenced)
 *   autonomy `suggest`/`draft` writes a suggestion card (an `ai_insight` row) instead
 * Anything the pure function marks suggest-only (a stage that opens a matter, a closing stage,
 * a welcome or payment signal) is a card in every mode, and a lead a person moved in the last
 * 7 days gets a card instead of a move: a person's placement wins.
 *
 * It is rule-based. It calls no model, queues no draft, sends nothing, and never sets a lane.
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

async function readMail(admin: SupabaseClient, orgId: string, sinceIso: string): Promise<MailRead> {
  const { data, error } = await admin
    .from("crm_activity")
    .select("id, lead_id, type, created_at, payload")
    .eq("org_id", orgId)
    .in("type", ["email_sent", "email_received"])
    .eq("payload->>source", "mailbox-sync")
    .not("lead_id", "is", null)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MAIL_CAP);
  if (error) throw new Error(`mail read failed: ${error.message}`);
  const rows = (data ?? []) as ActivityRow[];
  const signals = new Map<string, KeeperSignal[]>();
  for (const row of rows) {
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const messageId = text(p.message_id);
    if (!row.lead_id || !messageId) continue;
    const direction = p.direction === "outbound" ? "outbound" : p.direction === "inbound" ? "inbound" : row.type === "email_sent" ? "outbound" : "inbound";
    const signal: KeeperSignal = {
      source: "mail",
      messageId,
      type: text(p.type) ?? "other",
      direction,
      at: text(p.at) ?? row.created_at,
      subject: text(p.subject),
      sensitive: p.sensitive === true,
    };
    signals.set(row.lead_id, [...(signals.get(row.lead_id) ?? []), signal]);
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
    const { data, error } = await admin
      .from("crm_activity")
      .select("id, lead_id, type, actor_type, created_at, payload")
      .eq("org_id", orgId)
      .in("lead_id", batch)
      .in("type", ["stage_changed", "ai_insight"])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(HISTORY_CAP);
    if (error) throw new Error(`timeline read failed: ${error.message}`);
    const rows = (data ?? []) as ActivityRow[];

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
  const mail = await readMail(admin, orgId, new Date(nowMs - SIGNAL_WINDOW_DAYS * DAY_MS).toISOString());
  // The calendar half is optional: before lectual 0098 its columns do not exist.
  const calendar = await readConsults(admin, orgId, nowIso);
  if (calendar.state !== "ok") notes.push(CALENDAR_NOTE[calendar.state]);
  if (mail.truncated) notes.push("Mail read cut short; the newest was used.");

  const signalsByLead = new Map<string, KeeperSignal[]>(mail.signals);
  for (const [leadId, list] of calendar.signals) signalsByLead.set(leadId, [...(signalsByLead.get(leadId) ?? []), ...list]);

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
    const live = all.filter((s) => (s.source !== "payment" && s.sensitive) || !consumed.has(signalKeyFor(lead.id, s)));
    const target = targetStageFromSignals({ currentStageId: lead.current_stage_id }, live, stages, mapping, { now: nowMs });

    if (target.kind === "nothing") {
      if (target.reason === "sensitive") counts.sensitive += 1;
      continue;
    }

    const from = stageById.get(lead.current_stage_id);
    if (!from) continue;
    const signalKey = signalKeyFor(lead.id, target.signal);

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
