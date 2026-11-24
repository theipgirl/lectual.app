import type { SupabaseClient } from "@supabase/supabase-js";
import { isDatabaseUpdateNeeded } from "@/lib/calendar/outlook-errors";
import { joinHref } from "@/lib/calendar/outlook-format";
import { leadRead } from "@/lib/leads/live";
import { buildClientPrepDraft, type DraftTextGenerator } from "@/lib/prep-consult/drafts";
import { JudgmentBoundaryError, assertNoJudgmentContent, scrubJudgmentContent, type PrepConsultFacts } from "@/lib/prep-consult/prep-consult";
import type { InternalMail, InternalMailResult, CancelMail, CancelMailResult } from "@/lib/mail/internal-mail";
import { parseStageMapping, type StageMapping } from "@/lib/agents/stage-keeper/mapping";
import type { StageOpt } from "@/lib/reconcile/types";
import { PREP_SOURCE } from "@/lib/agents/consult-prep/constants";
import { MAILBOX_GATE_REASON, agentToolkitModuleState, mailboxModuleState } from "@/lib/agents/mailbox-gate";
import { IN_CHUNK, budgetNearlySpent, chunk, neutralise, readFirmStyle, realAddress } from "@/lib/agents/shared";
import type { AgentContext, AgentResult } from "@/lib/agents/types";
import {
  cardName,
  inquiryDescription,
  readLeadAnswers,
  readLeadFacts,
  readLeadFiles,
  readMailSummary,
  readMeetingHistory,
  type LeadFacts,
} from "@/lib/agents/consult-prep/facts";
import { briefOwnWording, renderConsultBrief, type BriefFacts } from "./brief";
import { PREP_BRIEF_KIND, PREP_SEND_SOURCE, eventPrepKey, markerEventId, normalizedStart, parsePrepKey, rerunKey, stagePrepKey } from "./keys";
import { readLawmaticsIntake, type LawmaticsRead, type ProspectReader } from "./lawmatics-intake";
import { CONSULT_PREP_KEY, guardRecipients, parseRecipientSetting } from "./recipients";
import {
  HOUR_MS,
  foldSendRecords,
  parseSendRecord,
  planSends,
  recordSlot,
  sendRecordPayload,
  shouldCancel,
  stageBookedRecently,
  type EventNow,
  type SendAction,
  type SendRecord,
  type SendStatus,
} from "./sends";
import { consultScheduledStage } from "./stage";

/**
 * Automatic consult prep (S1): the run behind the `consult-prep` assistant.
 *
 * A prep is made for ONE consult: the brief (facts only, `brief.ts`) is queued as an internal BRIEFING, the prep is
 * marked on the lead's timeline, and the brief is emailed to the firm's own consult-prep recipients (never a client)
 * when it is made, 24 hours before (if made more than a day ahead) and 1 hour before. See AGENTS.md "Automatic
 * consult prep" for every rule; the short version of what lives here:
 *
 *   candidates   future consults (Lawmatics sync rows always, Outlook only with the Mailboxes feature) in the next 14
 *                days that are flagged consults and linked to a live lead; plus live leads that entered the
 *                consult stage in the last 3 days and have no future consult. At most PREP_BATCH new preps a run.
 *   scope        a run may be narrowed to some leads (`ctx.scope`): the stage hook, a person's re-run, the sync.
 *   markers      one `queue_drafted` row per prep (ids and times). A key that has one is not built again.
 *   sends        one `ai_insight` row per send (`source: consult-prep-send`), append-only; the newest per (key, kind)
 *                is the truth. Resend holds a scheduled send; a change to the consult cancels it.
 *   nothing to a client. The client-prep EMAIL is still only a draft in the approval queue.
 *
 * Counts only leave this file: no name, address, mark or word of a brief reaches a log, the run's summary or an error.
 */

export const PREP_BATCH = 25;
/** Reminder emails scheduled in one run for preps that already exist. */
export const REMINDER_BATCH = 25;
/** The consult window and the stage window. */
export const EVENT_WINDOW_MS = 14 * 24 * HOUR_MS;
export const STAGE_WINDOW_MS = 3 * 24 * HOUR_MS;
/** Send records are read this far back: a scheduled send is at most 72 hours ahead, and the booked rule looks back 7 days. */
const SEND_LOOKBACK_MS = 8 * 24 * HOUR_MS;
const EVENT_ROWS = 300;
const NO_NEW_ITEM_RESERVE_MS = 20_000;

export type PrepDeps = {
  /** Resend's key and the sender, or null: email is not switched on, and the brief is still kept in Lectual. */
  mail: { apiKey: string | null; from: string | null };
  mailOut: (m: InternalMail) => Promise<InternalMailResult>;
  mailCancel: (c: CancelMail) => Promise<CancelMailResult>;
  prospects: ProspectReader;
  /** The current staff members' addresses among these user ids. `null` = the member list couldn't be read. */
  memberAddresses: (userIds: readonly string[]) => Promise<string[] | null>;
};

type EventRow = { id: string; org_id: string; lead_id: string | null; starts_at: string; join_url: string | null; is_consult: boolean | null; source: string | null; external_id?: string | null };

type Candidate = {
  /** The key the marker and the sends carry (a re-run's has its suffix). */
  key: string;
  /** The key without a re-run suffix: what an earlier prep of the same consult used. */
  baseKey: string;
  leadId: string;
  event: { id: string; startsAt: string; joinUrl: string | null } | null;
  rerun: boolean;
};

type Counts = {
  prepped: number;
  drafts: number;
  noAddress: number;
  noTemplate: number;
  refused: number;
  failed: number;
  partial: number;
  unrecorded: number;
  sent: number;
  scheduled: number;
  cancelled: number;
  cancelUnchecked: number;
  noRecipients: number;
  emailOff: number;
  recipientsUnread: number;
  sendFailed: number;
  nothingToDeliver: number;
  mergedSkipped: number;
  over: number;
  deferred: number;
  unreadSections: Record<string, number>;
};

const emptyCounts = (): Counts => ({
  prepped: 0, drafts: 0, noAddress: 0, noTemplate: 0, refused: 0, failed: 0, partial: 0, unrecorded: 0, sent: 0, scheduled: 0, cancelled: 0,
  cancelUnchecked: 0, noRecipients: 0, emailOff: 0, recipientsUnread: 0, sendFailed: 0, nothingToDeliver: 0, mergedSkipped: 0, over: 0, deferred: 0,
  unreadSections: { answers: 0, mail: 0, meetings: 0, files: 0, lawmatics: 0 },
});

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const skipped = (summary: string): AgentResult => ({ itemsIn: 0, draftsOut: 0, summary, skipped: true });

// ── reads (every statement names the firm) ───────────────────────────────────

async function readCalendar(admin: SupabaseClient, orgId: string, nowMs: number, outlook: boolean, leadIds: readonly string[] | undefined): Promise<{ rows: EventRow[]; outlookNotReady: boolean }> {
  const from = new Date(nowMs).toISOString();
  const to = new Date(nowMs + EVENT_WINDOW_MS).toISOString();
  const one = async (source: "lawmatics" | "outlook") => {
    let q = admin
      .from("crm_calendar_event")
      .select("id, org_id, lead_id, starts_at, join_url, is_consult, source, external_id")
      .eq("org_id", orgId)
      .eq("source", source)
      .eq("is_consult", true)
      .not("lead_id", "is", null)
      .gt("starts_at", from)
      .lte("starts_at", to);
    if (source === "lawmatics") q = q.like("external_id", "lmsync:%");
    if (leadIds) q = q.in("lead_id", [...leadIds]);
    return q.order("starts_at", { ascending: true }).limit(EVENT_ROWS);
  };
  const lawmatics = await one("lawmatics");
  if (lawmatics.error) {
    if (isDatabaseUpdateNeeded(lawmatics.error)) throw new DatabaseNotReady();
    throw new Error("The calendar could not be read, so no consults were prepped.");
  }
  let outlookRows: EventRow[] = [];
  let outlookNotReady = false;
  if (outlook) {
    const res = await one("outlook");
    if (res.error) {
      if (isDatabaseUpdateNeeded(res.error)) outlookNotReady = true;
      else throw new Error("The calendar could not be read, so no consults were prepped.");
    } else outlookRows = (res.data ?? []) as EventRow[];
  }
  const rows = [...((lawmatics.data ?? []) as EventRow[]), ...outlookRows].filter((e) => {
    const at = Date.parse(e.starts_at);
    const sourceOk = e.source === "lawmatics" ? typeof e.external_id === "string" && e.external_id.startsWith("lmsync:") : e.source === "outlook" && outlook;
    return e.org_id === orgId && e.is_consult === true && Boolean(e.lead_id) && sourceOk && at > nowMs && at <= nowMs + EVENT_WINDOW_MS && (!leadIds || leadIds.includes(e.lead_id as string));
  });
  rows.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  return { rows, outlookNotReady };
}

class DatabaseNotReady extends Error {}

async function readStages(admin: SupabaseClient, orgId: string): Promise<StageOpt[]> {
  const { data, error } = await admin.from("crm_stage").select("id, name, category, order_index").eq("org_id", orgId);
  if (error) throw new Error("stage read failed");
  return ((data ?? []) as Array<{ id: string; name: string; category: string; order_index: number }>).map((s) => ({ id: s.id, name: s.name, category: String(s.category), orderIndex: s.order_index }));
}

async function readMapping(admin: SupabaseClient, orgId: string): Promise<StageMapping> {
  const { data, error } = await admin.from("crm_firm_brain_entry").select("key, body, data").eq("org_id", orgId).eq("category", "stage_mapping");
  if (error) throw new Error("firm notes read failed");
  return parseStageMapping((data ?? []) as Array<{ key?: unknown; body?: unknown; data?: unknown }>);
}

/** Live (not merged) lead ids among these, org-fenced. */
async function liveLeadIds(admin: SupabaseClient, orgId: string, ids: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  for (const batch of chunk([...new Set(ids)], IN_CHUNK)) {
    const res = await leadRead(({ live }) => live(admin.from("crm_lead").select("id")).eq("org_id", orgId).in("id", batch));
    if (res.error) throw new Error("The leads could not be read, so no consults were prepped.");
    for (const r of (res.data ?? []) as Array<{ id: string }>) out.add(r.id);
  }
  return out;
}

type StageLead = { id: string; stageEnteredAt: string | null };

async function readStageLeads(admin: SupabaseClient, orgId: string, stageId: string, sinceMs: number | null, leadIds: readonly string[] | undefined): Promise<StageLead[]> {
  const res = await leadRead(({ live }) => {
    let q = live(admin.from("crm_lead").select("id, stage_entered_at")).eq("org_id", orgId).eq("current_stage_id", stageId);
    if (sinceMs !== null) q = q.gte("stage_entered_at", new Date(sinceMs).toISOString());
    if (leadIds) q = q.in("id", [...leadIds]);
    return q.limit(200);
  });
  if (res.error) throw new Error("The leads could not be read, so no consults were prepped.");
  return ((res.data ?? []) as Array<{ id: string; stage_entered_at: string | null }>).map((r) => ({ id: r.id, stageEnteredAt: r.stage_entered_at }));
}

/** The newest `stage_changed` row into the consult stage, for the key. Null when there is none (the caller falls back to the stage-entered time). */
async function newestStageRow(admin: SupabaseClient, orgId: string, leadId: string, stageId: string): Promise<string | null> {
  const { data, error } = await admin
    .from("crm_activity")
    .select("id")
    .eq("org_id", orgId)
    .eq("lead_id", leadId)
    .eq("type", "stage_changed")
    .eq("payload->>to_stage_id", stageId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error("stage history read failed");
  return ((data ?? [])[0] as { id?: string } | undefined)?.id ?? null;
}

type MarkerRead = { byKey: Map<string, string>; legacyEvents: Set<string> };

/** The prep markers for these keys and event ids. A marker with no `prep_key` is an older, event-keyed one. */
async function readMarkers(admin: SupabaseClient, orgId: string, eventIds: readonly string[]): Promise<MarkerRead> {
  const out: MarkerRead = { byKey: new Map(), legacyEvents: new Set() };
  for (const batch of chunk([...new Set(eventIds)], IN_CHUNK)) {
    const res = await admin
      .from("crm_activity")
      .select("created_at, payload")
      .eq("org_id", orgId)
      .eq("type", "queue_drafted")
      .eq("payload->>source", PREP_SOURCE)
      .in("payload->>event_id", batch);
    if (res.error) throw new Error("The prep history could not be read, so no consults were prepped.");
    for (const row of (res.data ?? []) as Array<{ created_at: string; payload: Record<string, unknown> | null }>) {
      const key = row.payload?.prep_key;
      if (typeof key === "string") {
        const have = out.byKey.get(key);
        if (!have || Date.parse(row.created_at) < Date.parse(have)) out.byKey.set(key, row.created_at);
      } else if (typeof row.payload?.event_id === "string") out.legacyEvents.add(row.payload.event_id);
    }
  }
  return out;
}

async function readSendRecords(admin: SupabaseClient, orgId: string, nowMs: number): Promise<SendRecord[]> {
  const { data, error } = await admin
    .from("crm_activity")
    .select("lead_id, created_at, payload")
    .eq("org_id", orgId)
    .eq("type", "ai_insight")
    .eq("payload->>source", PREP_SEND_SOURCE)
    .gte("created_at", new Date(nowMs - SEND_LOOKBACK_MS).toISOString())
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error("The send history could not be read, so no consults were prepped.");
  return ((data ?? []) as Array<{ lead_id: string | null; created_at: string; payload: unknown }>).map(parseSendRecord).filter((r): r is SendRecord => r !== null);
}

type RecipientsRead = { state: "ok"; to: string[]; cc: string[] } | { state: "none" } | { state: "unreadable" };

async function readRecipients(admin: SupabaseClient, orgId: string, deps: PrepDeps): Promise<RecipientsRead> {
  const { data, error } = await admin
    .from("crm_firm_brain_entry")
    .select("data")
    .eq("org_id", orgId)
    .eq("category", "other")
    .eq("key", CONSULT_PREP_KEY)
    .order("created_at", { ascending: true })
    .limit(1);
  if (error) return { state: "unreadable" };
  const setting = parseRecipientSetting(((data ?? [])[0] as { data?: unknown } | undefined)?.data);
  if (setting.userIds.length === 0) return { state: "none" };
  const to = await deps.memberAddresses(setting.userIds);
  if (to === null) return { state: "unreadable" };
  return to.length === 0 ? { state: "none" } : { state: "ok", to, cc: setting.cc };
}

// ── one prep ─────────────────────────────────────────────────────────────────

/** The leads merged INTO this one (lectual 0107), whose files stay on them. A failed read is null: the lead's own files are listed and it is said. */
async function readMergedIds(admin: SupabaseClient, orgId: string, leadId: string): Promise<string[] | null> {
  try {
    // live-guard: reads the leads merged INTO this one (a merged row is exactly what is wanted) to list their files
    const { data, error } = await admin.from("crm_lead").select("id, merged_into_id").eq("org_id", orgId).eq("merged_into_id", leadId);
    if (error) return (error as { code?: string }).code === "42703" || (error as { code?: string }).code === "PGRST204" ? [] : null;
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  } catch {
    return null;
  }
}

type Gathered = { lead: LeadFacts; facts: BriefFacts; clientAddresses: string[] };

async function gather(admin: SupabaseClient, orgId: string, c: Candidate, nowMs: number, tz: string, deps: PrepDeps, counts: Counts | null): Promise<Gathered | null> {
  const lead = await readLeadFacts(admin, orgId, c.leadId);
  if (!lead) return null;
  const mergedIds = await readMergedIds(admin, orgId, lead.id);
  const [answers, mail, meetings, files, lawmatics] = await Promise.all([
    readLeadAnswers(admin, orgId, lead.id),
    readMailSummary(admin, orgId, lead.id),
    readMeetingHistory(admin, orgId, lead.id),
    readLeadFiles(admin, orgId, lead.id, mergedIds ?? []),
    readLawmaticsIntake(deps.prospects, lead.lawmaticsId),
  ]);
  if (counts) {
    if (mergedIds === null) counts.unreadSections.files += 1;
    if (answers.state !== "ok") counts.unreadSections.answers += 1;
    if (mail.state !== "ok") counts.unreadSections.mail += 1;
    if (meetings.state !== "ok") counts.unreadSections.meetings += 1;
    if (files.state === "unavailable") counts.unreadSections.files += 1;
    if (lawmatics.state === "unavailable") counts.unreadSections.lawmatics += 1;
  }
  const facts: BriefFacts = {
    lead,
    startsAt: c.event?.startsAt ?? null,
    joinUrl: joinHref(c.event?.joinUrl ?? null),
    preparedAt: new Date(nowMs).toISOString(),
    tz,
    lawmatics: lawmatics as LawmaticsRead,
    answers,
    files,
    mail,
    meetings,
  };
  const clientAddresses = [lead.email, lawmatics.state === "ok" ? lawmatics.contactEmail : null].filter((a): a is string => !!a);
  return { lead, facts, clientAddresses };
}

/** Writes one send record (append-only). Returns false when the row could not be written. */
async function writeSendRecord(admin: SupabaseClient, orgId: string, leadId: string, r: Omit<SendRecord, "at" | "leadId">): Promise<boolean> {
  const { error } = await admin.from("crm_activity").insert({ org_id: orgId, lead_id: leadId, type: "ai_insight", actor_id: null, actor_type: "ai", payload: sendRecordPayload(r) });
  return !error;
}

type Mailer = {
  recipients: () => Promise<RecipientsRead>;
};

/** Sends (or schedules) what a plan says, each recorded. Every skip is counted. */
async function deliver(
  ctx: AgentContext,
  deps: PrepDeps,
  mailer: Mailer,
  counts: Counts,
  g: Gathered,
  c: Candidate,
  actions: readonly SendAction[],
): Promise<void> {
  if (actions.length === 0) return;
  const { apiKey, from } = deps.mail;
  if (!apiKey || !from) {
    counts.emailOff += actions.length;
    return;
  }
  const recipients = await mailer.recipients();
  if (recipients.state === "unreadable") {
    counts.recipientsUnread += 1;
    return;
  }
  if (recipients.state === "none") {
    counts.noRecipients += actions.length;
    return;
  }
  // The guard runs before EVERY send, with this lead's own addresses.
  const guarded = guardRecipients({ to: recipients.to, cc: recipients.cc, clientAddresses: g.clientAddresses });
  if (guarded.to.length === 0) {
    counts.noRecipients += actions.length;
    return;
  }
  for (const action of actions) {
    const brief = renderConsultBrief({ ...g.facts, send: action.kind });
    const scheduledFor = action.mode === "schedule" ? action.at : null;
    const result = await deps.mailOut({
      apiKey,
      from,
      to: guarded.to,
      ...(guarded.cc.length > 0 ? { cc: guarded.cc } : {}),
      subject: brief.subject,
      text: brief.text,
      html: brief.html,
      idempotencyKey: `consult-prep:${ctx.orgId}:${c.key}:${action.kind}`,
      ...(scheduledFor ? { scheduledAt: scheduledFor } : {}),
      label: "consult-prep",
    });
    const status: SendStatus = result.status === "sent" ? (action.mode === "schedule" ? "scheduled" : "sent") : "failed";
    if (result.status === "sent") {
      if (status === "scheduled") counts.scheduled += 1;
      else counts.sent += 1;
    } else counts.sendFailed += 1;
    const written = await writeSendRecord(ctx.admin, ctx.orgId, g.lead.id, {
      prepKey: c.key,
      kind: action.kind,
      resendId: result.status === "sent" ? (result.id ?? null) : null,
      scheduledFor,
      status,
    });
    if (!written) counts.unrecorded += 1;
  }
}

// ── cancel on change ─────────────────────────────────────────────────────────

async function cancelChanged(ctx: AgentContext, deps: PrepDeps, counts: Counts, folded: Map<string, SendRecord>, nowMs: number): Promise<void> {
  const scheduled = [...folded.values()].filter((r) => r.status === "scheduled" && (!r.scheduledFor || Date.parse(r.scheduledFor) > nowMs));
  if (scheduled.length === 0) return;
  const eventIds = [...new Set(scheduled.map((r) => parsePrepKey(r.prepKey)).flatMap((p) => (p && p.kind === "event" ? [p.eventId] : [])))];
  const now = new Map<string, EventNow>();
  for (const batch of chunk(eventIds, IN_CHUNK)) {
    const res = await ctx.admin.from("crm_calendar_event").select("id, starts_at, lead_id, is_consult").eq("org_id", ctx.orgId).in("id", batch);
    if (res.error) {
      // Not knowing is not "unchanged" and not "gone": nothing is cancelled on a guess, and it is said.
      counts.cancelUnchecked += scheduled.length;
      return;
    }
    for (const row of (res.data ?? []) as Array<{ id: string; starts_at: string | null; lead_id: string | null; is_consult: boolean | null }>) {
      now.set(row.id, { startsAt: row.starts_at, leadId: row.lead_id, isConsult: row.is_consult });
    }
  }
  for (const record of scheduled) {
    const parsed = parsePrepKey(record.prepKey);
    if (!parsed || parsed.kind !== "event") continue;
    if (!shouldCancel(record, now.get(parsed.eventId) ?? null)) continue;
    if (!record.resendId || !deps.mail.apiKey) {
      counts.cancelUnchecked += 1;
      continue;
    }
    const res = await deps.mailCancel({ apiKey: deps.mail.apiKey, id: record.resendId, label: "consult-prep" });
    if (res.status !== "cancelled") {
      counts.sendFailed += 1;
      continue;
    }
    counts.cancelled += 1;
    // The slot is no longer done: a later plan in this run sees it as cancelled.
    folded.set(recordSlot(record.prepKey, record.kind), { ...record, status: "cancelled", at: new Date(nowMs).toISOString() });
    const leadId = record.leadId ?? parsed.leadId;
    const ok = await writeSendRecord(ctx.admin, ctx.orgId, leadId, { prepKey: record.prepKey, kind: record.kind, resendId: record.resendId, scheduledFor: record.scheduledFor, status: "cancelled" });
    if (!ok) counts.unrecorded += 1;
  }
}

// ── the run ──────────────────────────────────────────────────────────────────

export async function runPrep(ctx: AgentContext, deps: PrepDeps, generate: DraftTextGenerator): Promise<AgentResult> {
  const { admin, orgId, autonomy } = ctx;
  const nowMs = ctx.now();
  const scope = ctx.scope;
  const scopedIds = scope?.leadIds && scope.leadIds.length > 0 ? scope.leadIds : undefined;
  if (scope?.leadIds && scope.leadIds.length === 0) return skipped("Skipped: no lead was named for this prep.");
  const outlook = mailboxModuleState(ctx) === "on";
  const counts = emptyCounts();

  // Candidates: consults on the calendar, then leads that entered the consult stage.
  let calendar: Awaited<ReturnType<typeof readCalendar>>;
  try {
    calendar = await readCalendar(admin, orgId, nowMs, outlook, scopedIds);
  } catch (err) {
    if (err instanceof DatabaseNotReady) return skipped("Skipped: the calendar isn't switched on for your firm yet.");
    throw err;
  }
  const live = await liveLeadIds(admin, orgId, calendar.rows.map((e) => e.lead_id as string));
  counts.mergedSkipped += calendar.rows.filter((e) => !live.has(e.lead_id as string)).length;
  const events = calendar.rows.filter((e) => live.has(e.lead_id as string));
  const withConsult = new Set(events.map((e) => e.lead_id as string));

  const candidates: Candidate[] = events.map((e) => {
    const base = eventPrepKey(e.lead_id as string, e.id, e.starts_at);
    const rerun = scope?.reason === "rerun";
    return { key: rerun ? rerunKey(base, nowMs) : base, baseKey: base, leadId: e.lead_id as string, event: { id: e.id, startsAt: normalizedStart(e.starts_at) ?? e.starts_at, joinUrl: e.join_url }, rerun };
  });

  let stageUnread = false;
  try {
    const [stages, mapping] = await Promise.all([readStages(admin, orgId), readMapping(admin, orgId)]);
    const stage = consultScheduledStage(stages, mapping);
    if (stage) {
      const rerun = scope?.reason === "rerun";
      const leads = await readStageLeads(admin, orgId, stage.id, rerun ? null : nowMs - STAGE_WINDOW_MS, scopedIds);
      for (const lead of leads) {
        if (withConsult.has(lead.id)) continue;
        const rowId = (await newestStageRow(admin, orgId, lead.id, stage.id)) ?? lead.stageEnteredAt;
        if (!rowId) continue;
        const base = stagePrepKey(lead.id, rowId);
        candidates.push({ key: rerun ? rerunKey(base, nowMs) : base, baseKey: base, leadId: lead.id, event: null, rerun });
      }
    }
  } catch {
    stageUnread = true;
  }
  // What is already done: prep markers and send records. Either unreadable ends the run (a guess could prep or send twice).
  const markers = await readMarkers(admin, orgId, candidates.map((c) => markerEventId(c.baseKey)).filter((x): x is string => !!x));
  const records = await readSendRecords(admin, orgId, nowMs);
  const folded = foldSendRecords(records);

  const style = await readFirmStyle(admin, orgId);

  // Cancel what a change made wrong, before anything new is scheduled.
  await cancelChanged(ctx, deps, counts, folded, nowMs);
  if (candidates.length === 0) {
    const parts = ["No consults need prep."];
    if (counts.cancelled > 0) parts.push(`${plural(counts.cancelled, "reminder", "reminders")} cancelled.`);
    if (counts.cancelUnchecked > 0) parts.push(`${plural(counts.cancelUnchecked, "scheduled email", "scheduled emails")} could not be checked against the calendar.`);
    if (counts.sendFailed > 0) parts.push(`${plural(counts.sendFailed, "email", "emails")} could not be sent or cancelled and will be tried again.`);
    if (stageUnread) parts.push("The consult stage could not be read, so leads were not checked by stage.");
    if (calendar.outlookNotReady) parts.push("The Outlook calendar isn't switched on for your firm yet.");
    if (mailboxModuleState(ctx) === "unreadable") parts.push(`Outlook consults were not read: ${MAILBOX_GATE_REASON.unreadable}.`);
    return { itemsIn: 0, draftsOut: 0, summary: parts.join(" ") };
  }

  let recipientsCache: Promise<RecipientsRead> | null = null;
  const mailer: Mailer = { recipients: () => (recipientsCache ??= readRecipients(admin, orgId, deps)) };

  const templateOn = agentToolkitModuleState(ctx) === "on";
  let newPreps = 0;
  let reminders = 0;
  for (const c of candidates) {
    if (budgetNearlySpent(ctx, NO_NEW_ITEM_RESERVE_MS)) {
      counts.deferred += 1;
      continue;
    }
    const existing = new Map(folded);
    // A re-run's reminders are not duplicated: the earlier prep of this consult keeps its own.
    if (c.rerun) for (const kind of ["24h", "1h"] as const) {
      const earlier = folded.get(recordSlot(c.baseKey, kind));
      if (earlier) existing.set(recordSlot(c.key, kind), earlier);
    }
    const preppedAt = c.rerun ? undefined : markers.byKey.get(c.key);
    const legacy = !c.rerun && c.event !== null && markers.legacyEvents.has(c.event.id);
    const startMs = c.event ? Date.parse(c.event.startsAt) : null;
    try {
      if (preppedAt !== undefined || legacy) {
        // Already prepped: only what is still owed (a reminder inside Resend's window, a booked email that failed).
        if (reminders >= REMINDER_BATCH) {
          counts.over += 1;
          continue;
        }
        const plan = planSends({
          prepKey: c.key,
          startsAtMs: startMs,
          nowMs,
          preppedAtMs: preppedAt !== undefined ? Date.parse(preppedAt) : nowMs - 24 * HOUR_MS - 1,
          madeNow: false,
          suppressBooked: false,
          existing,
        });
        // A prep from before the sends existed has no booked email to retry and made no promise about reminders it never planned.
        const actions = legacy ? [] : plan.actions;
        if (actions.length === 0) continue;
        reminders += 1;
        const g = await gather(admin, orgId, c, nowMs, style.timeZone, deps, null);
        if (!g) {
          counts.failed += 1;
          continue;
        }
        await deliver(ctx, deps, mailer, counts, g, c, actions);
        continue;
      }

      if (newPreps >= PREP_BATCH) {
        counts.over += 1;
        continue;
      }
      const g = await gather(admin, orgId, c, nowMs, style.timeZone, deps, counts);
      if (!g) {
        counts.failed += 1;
        continue;
      }
      const { lead, facts } = g;
      const name = cardName(lead);
      const shownName = scrubJudgmentContent(name);
      const brief = renderConsultBrief(facts);
      // Build and check BOTH drafts before queueing either.
      assertNoJudgmentContent(briefOwnWording(facts), "consult prep brief");
      const address = realAddress(lead.email);
      let clientBody: string | null = null;
      if (autonomy !== "suggest" && c.event) {
        if (!templateOn) counts.noTemplate += 1;
        else if (!address) counts.noAddress += 1;
        else {
          const prepFacts: PrepConsultFacts = {
            clientName: neutralise(shownName),
            clientEmail: address,
            practiceArea: neutralise(scrubJudgmentContent(lead.practiceArea?.trim() || "Not specified")),
            inquiryDescription: neutralise(inquiryDescription(lead, facts.answers)),
            sessionWhen: new Intl.DateTimeFormat("en-US", {
              timeZone: style.timeZone,
              weekday: "long",
              month: "long",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZoneName: "short",
            }).format(new Date(c.event.startsAt)),
            zoomLink: facts.joinUrl,
          };
          try {
            clientBody = (await buildClientPrepDraft(prepFacts, generate)).draftBody;
          } catch (err) {
            // A draft with attorney-judgment content holds the whole prep back (both drafts are checked before either is queued).
            // Any other failure (the model, the key) costs only the client draft: the brief and its emails are the point of the run.
            if (err instanceof JudgmentBoundaryError) throw err;
            counts.partial += 1;
          }
        }
      }

      const queued: Array<{ kind: string; id: string | null }> = [];
      let queueFailed = false;
      if (ctx.queueOrgKey) {
        try {
          const item = await ctx.createDraft({
            orgKey: ctx.queueOrgKey,
            agent: PREP_SOURCE,
            type: "BRIEFING",
            headline: `Consult prep for ${shownName}`,
            summary: `Internal consult prep for ${shownName}: the facts on file, ready before the call. Prepared by the Consult prep assistant; nothing was sent to the client.`,
            draftBody: brief.text,
            clientName: name,
            leadId: lead.id,
          });
          queued.push({ kind: PREP_BRIEF_KIND, id: item.id });
          if (clientBody) {
            try {
              const prep = await ctx.createDraft({
                orgKey: ctx.queueOrgKey,
                agent: PREP_SOURCE,
                type: "CLIENT_EMAIL",
                headline: `Consult prep email for ${shownName}`,
                summary: `Asks ${shownName} what to have ready before the strategy session. Confirms only the appointment details on the calendar.`,
                clientName: name,
                leadId: lead.id,
                recipient: address as string,
                subject: "Preparing for your strategy session",
                draftBody: clientBody,
                signOff: style.signOff,
              });
              queued.push({ kind: "client_prep", id: prep.id });
            } catch {
              counts.partial += 1;
            }
          }
        } catch {
          queueFailed = true;
        }
      }
      // With no queue and no way to email, there is nowhere to put the brief: nothing is marked, so a later run (once
      // approvals or email are set up) still prepares it.
      const canEmail = Boolean(deps.mail.apiKey && deps.mail.from);
      if (queued.length === 0 && (queueFailed || !canEmail)) {
        if (queueFailed) counts.failed += 1;
        else counts.nothingToDeliver += 1;
        continue;
      }
      if (queued.length === 0) queued.push({ kind: PREP_BRIEF_KIND, id: null });

      counts.prepped += 1;
      newPreps += 1;
      counts.drafts += queued.filter((q) => q.id).length;
      const { error: recordError } = await admin.from("crm_activity").insert(
        queued.map((q) => ({
          org_id: orgId,
          lead_id: lead.id,
          type: "queue_drafted",
          actor_id: null,
          actor_type: "ai",
          payload: {
            source: PREP_SOURCE,
            agent: PREP_SOURCE,
            kind: q.kind,
            event_id: markerEventId(c.baseKey),
            prep_key: c.key,
            ...(c.event ? { start_at: c.event.startsAt } : {}),
            ...(q.id ? { queueItemId: q.id } : {}),
          },
        })),
      );
      if (recordError) counts.unrecorded += 1;

      const bookedHeld = !!c.event && stageBookedRecently(records, lead.id, nowMs);
      const plan = planSends({ prepKey: c.key, startsAtMs: startMs, nowMs, preppedAtMs: nowMs, madeNow: true, suppressBooked: bookedHeld, existing });
      await deliver(ctx, deps, mailer, counts, g, c, plan.actions);
    } catch (err) {
      if (err instanceof JudgmentBoundaryError) counts.refused += 1;
      else counts.failed += 1;
    }
  }

  return { itemsIn: counts.prepped, draftsOut: counts.drafts, summary: summaryOf(counts, stageUnread, calendar.outlookNotReady, mailboxModuleState(ctx)) };
}

function summaryOf(c: Counts, stageUnread: boolean, outlookNotReady: boolean, outlookGate: "on" | "off" | "unreadable"): string {
  const parts = [`${plural(c.prepped, "consult", "consults")} prepped, ${plural(c.drafts, "draft", "drafts")} queued.`];
  const mail: string[] = [];
  if (c.sent > 0) mail.push(`${plural(c.sent, "email", "emails")} sent`);
  if (c.scheduled > 0) mail.push(`${plural(c.scheduled, "reminder", "reminders")} scheduled`);
  if (c.cancelled > 0) mail.push(`${plural(c.cancelled, "reminder", "reminders")} cancelled`);
  if (mail.length > 0) parts.push(`${mail.join(", ")}.`);
  if (c.noRecipients > 0) parts.push(`${plural(c.noRecipients, "email", "emails")} not sent: no one is set to receive consult prep.`);
  if (c.emailOff > 0) parts.push(`${plural(c.emailOff, "email", "emails")} not sent: email isn't switched on for your firm yet.`);
  if (c.recipientsUnread > 0) parts.push("Who gets consult prep could not be read, so some emails were not sent.");
  if (c.sendFailed > 0) parts.push(`${plural(c.sendFailed, "email", "emails")} could not be sent or cancelled and will be tried again.`);
  if (c.cancelUnchecked > 0) parts.push(`${plural(c.cancelUnchecked, "scheduled email", "scheduled emails")} could not be checked against the calendar.`);
  if (c.nothingToDeliver > 0) parts.push(`${plural(c.nothingToDeliver, "consult", "consults")} left for a later run: approvals and email are both off, so there is nowhere to put the prep.`);
  if (c.noTemplate > 0) parts.push(`${plural(c.noTemplate, "consult", "consults")} got only the heads-up: the client-prep email template isn't set up for this firm, so no client email was written.`);
  if (c.noAddress > 0) parts.push(`${plural(c.noAddress, "consult", "consults")} had no client address, so only the heads-up was written.`);
  if (c.refused > 0) parts.push(`${plural(c.refused, "consult", "consults")} held back because a draft contained attorney-judgment content.`);
  if (c.failed > 0) parts.push(`${plural(c.failed, "consult", "consults")} could not be prepped and will be tried again.`);
  if (c.partial > 0) parts.push(`${plural(c.partial, "consult", "consults")} got the heads-up but not the client email.`);
  if (c.unrecorded > 0) parts.push(`${plural(c.unrecorded, "prep", "preps")} could not be recorded on the lead, so they may be drafted again.`);
  const missing = Object.entries(c.unreadSections).filter(([, n]) => n > 0).map(([k]) => k);
  if (missing.length > 0) parts.push(`Some card sections could not be read: ${missing.join(", ")}.`);
  if (c.mergedSkipped > 0) parts.push(`${plural(c.mergedSkipped, "consult", "consults")} skipped: the lead was merged into another.`);
  if (stageUnread) parts.push("The consult stage could not be read, so leads were not checked by stage.");
  if (outlookNotReady) parts.push("The Outlook calendar isn't switched on for your firm yet.");
  // Outlook consults are read only with the Mailboxes feature; a feature list that could not be read is said, never "none".
  if (outlookGate === "unreadable") parts.push(`Outlook consults were not read: ${MAILBOX_GATE_REASON.unreadable}.`);
  if (c.over > 0) parts.push(`${plural(c.over, "consult", "consults")} left for the next run (limit ${PREP_BATCH}).`);
  if (c.deferred > 0) parts.push(`${plural(c.deferred, "consult", "consults")} left for the next run: this run ran out of time.`);
  return parts.join(" ");
}

