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
import { IN_CHUNK, budgetNearlySpent, chunk, neutralise, orgFencedReader, readFirmStyle, realAddress } from "@/lib/agents/shared";
import { resolveBatch, type Resolved } from "@/lib/queue/resolve-batch";
import type { QueueItem } from "@/lib/queue/api";
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
import { adoptableItems, adoptionSinceMs, itemText, pickAdoption, stillAdoptable } from "./adopt";
import { briefOwnWording, renderAdoptedBrief, renderConsultBrief, type BriefFacts } from "./brief";
import { attachmentsForEmail, type AttachPlan, type PrepFile } from "./attachments";
import type { FullBuild, FullBuildFailure } from "./full";
import type { PrepFileStore } from "./save-files";
import { PREP_BRIEF_KIND, PREP_BUILD_SOURCE, PREP_SEND_SOURCE, eventPrepKey, markerEventId, normalizedStart, parsePrepKey, rerunKey, stagePrepKey } from "./keys";
import { readLawmaticsIntake, type LawmaticsRead, type ProspectReader } from "./lawmatics-intake";
import { CONSULT_PREP_KEY, guardRecipients, guardReplyTo, parseRecipientSetting } from "./recipients";
import { lawmaticsReach, type CutoverReach } from "./cutover";
import type { GuardResult } from "./recipients";
import {
  HOUR_MS,
  SEND_KINDS,
  foldSendRecords,
  parseSendRecord,
  planSends,
  recordSlot,
  sendRecordPayload,
  shouldCancel,
  stageBookedRecently,
  type BriefQuality,
  type EventNow,
  type SendAction,
  type SendKind,
  type SendRecord,
  type SendStatus,
} from "./sends";
import { consultScheduledStage } from "./stage";
import { recipientsSha256 } from "./recipient-hash";
import { collapseTwins, hasTwinMarker } from "./twins";
import { sameLeadSameTime } from "@/lib/calendar/booked-merge";

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
const STAGE_LEAD_ROWS = 200;
const SEND_ROWS = 2000;
const SCOPED_SEND_ROWS = 500;
const MARKER_ROWS = 1000;
/** A read that came back exactly as long as its limit may have been cut short: the run fails rather than treat part as all. */
const CUT_SHORT = "A read was cut short, so no consults were prepped.";
const NO_NEW_ITEM_RESERVE_MS = 20_000;
/** The BRIEFING's summary line for a full prep (S2b). */
const FULL_SUMMARY = (name: string): string =>
  `Internal consult prep for ${name}: the facts on file, the likely classes, a first look at conflicts, a package suggestion and questions for the call. Prepared by the Consult prep assistant; nothing was sent to the client.`;
/** Why a full build failed, in words for the run's summary (codes only reach it, never a model's words). */
const FULL_FAILURE_WORDS: Record<FullBuildFailure, string> = {
  timeout: "the model took too long",
  error: "the model call failed",
  invalid: "the model's answer could not be used",
  refused: "the model declined",
  truncated: "the model's answer was cut off",
  budget: "the run ran out of time",
  uspto: "the USPTO search was unavailable",
  packages: "the firm's package list couldn't be read",
  unexpected: "something went wrong",
};

export type PrepDeps = {
  /**
   * Resend's key and the sender, or null: email is not switched on, and the brief is still kept in Lectual. `replyTo` (S2c,
   * `CONSULT_PREP_REPLY_TO`, already a bare address or null) is put on an email only when `guardReplyTo` allows it for that email.
   */
  mail: { apiKey: string | null; from: string | null; replyTo?: string | null };
  /**
   * S2c: `CONSULT_PREP_CUTOVER_AT` as an instant, or null (unset or not a full ISO instant with a zone = no cutover rule). An
   * event-keyed email lawmatics-mcp may already have scheduled before it was switched off is not sent (`cutover.ts`).
   */
  cutoverAtMs?: number | null;
  mailOut: (m: InternalMail) => Promise<InternalMailResult>;
  mailCancel: (c: CancelMail) => Promise<CancelMailResult>;
  prospects: ProspectReader;
  /** The current staff members' addresses among these user ids. `null` = the member list couldn't be read. */
  memberAddresses: (userIds: readonly string[]) => Promise<string[] | null>;
  /**
   * S2b: builds the FULL prep for one consult (at most two model calls through the run's `ctx.llm`, the USPTO knockout, the firm's
   * prices, the two files). Never throws. Absent = the facts brief only (what S1/S2a did; tests that do not exercise the build).
   */
  full?: (facts: BriefFacts) => Promise<FullBuild>;
  /** S2b: the lead's Documents & files, for the full prep's two files (save once per prep key, read back for a later email). */
  files?: PrepFileStore;
};

type EventRow = { id: string; org_id: string; lead_id: string | null; starts_at: string; join_url: string | null; is_consult: boolean | null; source: string | null; external_id?: string | null; created_at?: string | null };

type Candidate = {
  /** The key the marker and the sends carry (a re-run's has its suffix). */
  key: string;
  /** The key without a re-run suffix: what an earlier prep of the same consult used. */
  baseKey: string;
  leadId: string;
  event: { id: string; startsAt: string; joinUrl: string | null } | null;
  rerun: boolean;
  /** When the consult was booked: the calendar row's own `created_at`, else (a stage-keyed prep) the lead's stage-entered time. Null = not known. */
  bookedAt: string | null;
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
  duplicate: number;
  leadsOver: number;
  leftSkipped: number;
  twins: number;
  alreadyPrepped: number;
  leftCancelled: number;
  recipientsChanged: number;
  over: number;
  deferred: number;
  /** Preps that reused a full brief already in Approvals (no new briefing was queued). */
  adopted: number;
  /** Candidates left for the next run because Approvals could not be read (no adoption, and no build, on a guess). */
  adoptionUnread: number;
  /** Booked / 24 h emails not sent because the prep only has the facts brief (they stay owed). */
  withheld: number;
  /** 1 h emails sent or scheduled as "facts only". */
  factsOnly: number;
  /** S2c: emails not sent because lawmatics-mcp may already have scheduled its own brief for that consult (counted when the row is written). */
  superseded: number;
  /** S2c: emails sent without the configured reply-to because it isn't a firm address for that email. */
  replyToRefused: number;
  /** Scheduled facts-only 1 h emails cancelled and planned again with a full brief. */
  upgraded: number;
  /** Scheduled emails cancelled because the Approvals item they carried was rejected or is gone. */
  adoptedGone: number;
  /** S2b: full preps built (new, re-run, or a retry of a prep that only had the facts brief). */
  fullBuilt: number;
  /** S2b: full builds that failed, by reason code (the brief stays facts and the next run tries again). */
  fullFailed: Partial<Record<FullBuildFailure, number>>;
  /** S2b: emails the mail service refused WITH attachments, re-posted once without them. */
  attachRefused: number;
  /** S2b: the full prep's files saved to Documents & files, already there, skipped (storage not switched on), or not saved. */
  filesSaved: number;
  filesSkipped: number;
  filesFailed: number;
  /** S2b: files saved whose timeline entry did not land. */
  filesUnlogged: number;
  /** S2b: consults that got the facts brief only because the firm has no queue (a full prep's text is kept in Approvals for every email). */
  fullNoQueue: number;
  /** S2b: full builds not tried because this prep already had MAX_BUILD_ATTEMPTS attempts. */
  buildCapped: number;
  /** S2b: preps whose full brief was queued on an earlier run but whose marker was not written: the marker was written now, nothing rebuilt. */
  repaired: number;
  unreadSections: Record<string, number>;
};

const emptyCounts = (): Counts => ({
  prepped: 0, drafts: 0, noAddress: 0, noTemplate: 0, refused: 0, failed: 0, partial: 0, unrecorded: 0, sent: 0, scheduled: 0, cancelled: 0,
  cancelUnchecked: 0, noRecipients: 0, emailOff: 0, recipientsUnread: 0, sendFailed: 0, nothingToDeliver: 0, mergedSkipped: 0, duplicate: 0, leadsOver: 0, leftSkipped: 0, twins: 0, alreadyPrepped: 0, leftCancelled: 0, recipientsChanged: 0, over: 0, deferred: 0, adopted: 0, adoptionUnread: 0, withheld: 0, factsOnly: 0, superseded: 0, replyToRefused: 0, upgraded: 0, adoptedGone: 0,
  fullBuilt: 0, fullFailed: {}, attachRefused: 0, filesSaved: 0, filesSkipped: 0, filesFailed: 0, filesUnlogged: 0, fullNoQueue: 0, buildCapped: 0, repaired: 0,
  unreadSections: { answers: 0, mail: 0, meetings: 0, files: 0, lawmatics: 0, labels: 0 },
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
      .select("id, org_id, lead_id, starts_at, join_url, is_consult, source, external_id, created_at")
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
  const cutShort = (res: { data: unknown[] | null }) => (res.data ?? []).length >= EVENT_ROWS;
  const lawmatics = await one("lawmatics");
  if (lawmatics.error) {
    if (isDatabaseUpdateNeeded(lawmatics.error)) throw new DatabaseNotReady();
    throw new Error("The calendar could not be read, so no consults were prepped.");
  }
  if (cutShort(lawmatics)) throw new Error(CUT_SHORT);
  let outlookRows: EventRow[] = [];
  let outlookNotReady = false;
  if (outlook) {
    const res = await one("outlook");
    if (res.error) {
      if (isDatabaseUpdateNeeded(res.error)) outlookNotReady = true;
      else throw new Error("The calendar could not be read, so no consults were prepped.");
    } else {
      if (cutShort(res)) throw new Error(CUT_SHORT);
      outlookRows = (res.data ?? []) as EventRow[];
    }
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
    return q.limit(STAGE_LEAD_ROWS);
  });
  if (res.error) throw new Error("The leads could not be read, so no consults were prepped.");
  if ((res.data ?? []).length >= STAGE_LEAD_ROWS) throw new Error(CUT_SHORT);
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

type MarkerRead = {
  byKey: Map<string, string>;
  legacyEvents: Set<string>;
  /** Prep key -> the id of the Approvals item whose text the prep's emails carry: one it adopted, or (S2b) the full prep it built. */
  adopted: Map<string, string>;
  /** S2b: prep key -> what became of each file when this assistant built the full prep (the marker's `attach`). */
  built: Map<string, AttachPlan | null>;
};

const ATTACH_CODES = /^[a-z_]{1,40}$/;
/** A marker's `attach` object, codes only (anything else is dropped). */
function parseAttachPlan(v: unknown): AttachPlan {
  const out: AttachPlan = {};
  if (!v || typeof v !== "object") return out;
  for (const k of ["uspto_xlsx", "packages_pdf"] as const) {
    const code = (v as Record<string, unknown>)[k];
    if (typeof code === "string" && ATTACH_CODES.test(code)) out[k] = code;
  }
  return out;
}

/** The prep markers for these keys and event ids. A marker with no `prep_key` is an older, event-keyed one. */
async function readMarkers(admin: SupabaseClient, orgId: string, eventIds: readonly string[]): Promise<MarkerRead> {
  const out: MarkerRead = { byKey: new Map(), legacyEvents: new Set(), adopted: new Map(), built: new Map() };
  const adoptedAt = new Map<string, string>();
  for (const batch of chunk([...new Set(eventIds)], IN_CHUNK)) {
    const res = await admin
      .from("crm_activity")
      .select("created_at, payload")
      .eq("org_id", orgId)
      .eq("type", "queue_drafted")
      .eq("payload->>source", PREP_SOURCE)
      .in("payload->>event_id", batch)
      .limit(MARKER_ROWS);
    if (res.error) throw new Error("The prep history could not be read, so no consults were prepped.");
    if ((res.data ?? []).length >= MARKER_ROWS) throw new Error(CUT_SHORT);
    for (const row of (res.data ?? []) as Array<{ created_at: string; payload: Record<string, unknown> | null }>) {
      const key = row.payload?.prep_key;
      const carries = row.payload?.adopted === true || row.payload?.full === true;
      if (typeof key === "string" && carries && typeof row.payload?.queueItemId === "string") {
        const seen = adoptedAt.get(key);
        if (!seen || Date.parse(row.created_at) >= Date.parse(seen)) {
          adoptedAt.set(key, row.created_at);
          out.adopted.set(key, row.payload.queueItemId);
          // The newest carrying marker decides: an adopted item carries no files of this assistant's.
          out.built.set(key, row.payload?.full === true ? parseAttachPlan(row.payload?.attach) : null);
        }
      }
      if (typeof key === "string") {
        // A person's re-run marker (`<base>:rerun:<ms>`) is also the base key's prep: the base is built (BRIEFING, client draft, booked
        // email) already, and only its reminders, which a re-run never plans, are still owed. Reminders are planned for it as for any prep.
        for (const k of new Set([key, key.replace(/:rerun:\d+$/, "")])) {
          const have = out.byKey.get(k);
          if (!have || Date.parse(row.created_at) < Date.parse(have)) out.byKey.set(k, row.created_at);
        }
      } else if (typeof row.payload?.event_id === "string") out.legacyEvents.add(row.payload.event_id);
    }
  }
  return out;
}

/** Send records, oldest first. A scoped run reads only its leads' rows. A read that fills its limit fails the run: part of the history is not the history. */
async function readSendRecords(admin: SupabaseClient, orgId: string, nowMs: number, leadIds?: readonly string[]): Promise<SendRecord[]> {
  const limit = leadIds ? SCOPED_SEND_ROWS : SEND_ROWS;
  let q = admin
    .from("crm_activity")
    .select("lead_id, created_at, payload")
    .eq("org_id", orgId)
    .eq("type", "ai_insight")
    .eq("payload->>source", PREP_SEND_SOURCE)
    .gte("created_at", new Date(nowMs - SEND_LOOKBACK_MS).toISOString());
  if (leadIds) q = q.in("lead_id", [...leadIds]);
  const { data, error } = await q.order("created_at", { ascending: true }).limit(limit);
  if (error) throw new Error("The send history could not be read, so no consults were prepped.");
  if ((data ?? []).length >= limit) throw new Error(CUT_SHORT);
  return ((data ?? []) as Array<{ lead_id: string | null; created_at: string; payload: unknown }>).map(parseSendRecord).filter((r): r is SendRecord => r !== null);
}

/** Prep markers on these leads whose consult had a start: what a twin of the same call is judged against. */
type LeadMarker = { leadId: string; startAt: string; eventId: string | null };

async function readLeadMarkers(admin: SupabaseClient, orgId: string, leadIds: readonly string[]): Promise<LeadMarker[]> {
  const out: LeadMarker[] = [];
  for (const batch of chunk([...new Set(leadIds)], IN_CHUNK)) {
    const res = await admin
      .from("crm_activity")
      .select("lead_id, payload")
      .eq("org_id", orgId)
      .eq("type", "queue_drafted")
      .eq("payload->>source", PREP_SOURCE)
      .in("lead_id", batch)
      .limit(MARKER_ROWS);
    if (res.error) throw new Error("The prep history could not be read, so no consults were prepped.");
    if ((res.data ?? []).length >= MARKER_ROWS) throw new Error(CUT_SHORT);
    for (const row of (res.data ?? []) as Array<{ lead_id: string | null; payload: Record<string, unknown> | null }>) {
      const startAt = row.payload?.start_at;
      if (row.lead_id && typeof startAt === "string") out.push({ leadId: row.lead_id, startAt, eventId: typeof row.payload?.event_id === "string" ? row.payload.event_id : null });
    }
  }
  return out;
}

/** The leads among these that have ANY future consult event, whatever the source and however far off. A failed read throws. */
async function leadsWithFutureConsult(admin: SupabaseClient, orgId: string, leadIds: readonly string[], nowMs: number): Promise<Set<string>> {
  const out = new Set<string>();
  for (const batch of chunk([...new Set(leadIds)], IN_CHUNK)) {
    const res = await admin
      .from("crm_calendar_event")
      .select("lead_id")
      .eq("org_id", orgId)
      .eq("is_consult", true)
      .in("lead_id", batch)
      .gt("starts_at", new Date(nowMs).toISOString())
      .limit(MARKER_ROWS);
    if (res.error) throw new Error("The calendar could not be read for the stage check.");
    if ((res.data ?? []).length >= MARKER_ROWS) throw new Error(CUT_SHORT);
    for (const r of (res.data ?? []) as Array<{ lead_id: string | null }>) if (r.lead_id) out.add(r.lead_id);
  }
  return out;
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
async function readMergedLeads(admin: SupabaseClient, orgId: string, leadId: string): Promise<Array<{ id: string; email: string | null }> | null> {
  try {
    // live-guard: reads the leads merged INTO this one (a merged row is exactly what is wanted) to list their files
    const { data, error } = await admin.from("crm_lead").select("id, email, merged_into_id").eq("org_id", orgId).eq("merged_into_id", leadId);
    if (error) return (error as { code?: string }).code === "42703" || (error as { code?: string }).code === "PGRST204" ? [] : null;
    return ((data ?? []) as Array<{ id: string; email?: string | null }>).map((r) => ({ id: r.id, email: r.email ?? null }));
  } catch {
    return null;
  }
}

const EMAIL_SHAPED = /[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;
/** Every email-shaped string in a text (the guard re-validates each). */
export const emailsIn = (text: string | null | undefined): string[] => (typeof text === "string" ? (text.match(EMAIL_SHAPED) ?? []) : []);

type Gathered = { lead: LeadFacts; facts: BriefFacts; clientAddresses: string[] };

async function gather(admin: SupabaseClient, orgId: string, c: Candidate, nowMs: number, tz: string, deps: PrepDeps, counts: Counts | null): Promise<Gathered | null> {
  const lead = await readLeadFacts(admin, orgId, c.leadId);
  if (!lead) return null;
  const mergedLeads = await readMergedLeads(admin, orgId, lead.id);
  const mergedIds = mergedLeads ? mergedLeads.map((m) => m.id) : null;
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
    if (lawmatics.state === "ok" && lawmatics.labels === "failed") counts.unreadSections.labels += 1;
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
  // Every address that is the client's: the lead's own, the Lawmatics contact's, the old emails of leads merged into this one, and any
  // email-shaped text in the intake answers or the Lawmatics fields (a client who types a colleague's or their own second address).
  const texts: string[] = [];
  if (answers.state === "ok") for (const b of answers.blocks) for (const p of b.pairs) texts.push(p.question, p.answer);
  if (lawmatics.state === "ok") {
    texts.push(JSON.stringify(lawmatics.intake));
    for (const p of lawmatics.other) texts.push(p.label, p.value);
  }
  const clientAddresses = [
    lead.email,
    lawmatics.state === "ok" ? lawmatics.contactEmail : null,
    ...(mergedLeads ?? []).map((m) => m.email),
    ...texts.flatMap(emailsIn),
  ].filter((a): a is string => !!a);
  return { lead, facts, clientAddresses };
}

/** Writes one send record (append-only). Returns false when the row could not be written. */
async function writeSendRecord(
  admin: SupabaseClient,
  orgId: string,
  leadId: string,
  r: Omit<SendRecord, "at" | "leadId">,
): Promise<boolean> {
  const { error } = await admin.from("crm_activity").insert({ org_id: orgId, lead_id: leadId, type: "ai_insight", actor_id: null, actor_type: "ai", payload: sendRecordPayload(r) });
  return !error;
}

/**
 * What a prep's emails carry. `adopted`: the text of the full brief already in Approvals (every email sends it). Absent: the facts
 * brief only, which is emailed as a marked 1 h email and never as booked or 24 h.
 */
type PrepContent = {
  adopted: string | null;
  /**
   * S2b: a full prep THIS assistant built carries its two files. `files` are the bytes built in this run, or "load": read the copies saved
   * to the lead's Documents & files (a later run's email). An adopted prep (a person's or the skill's) carries none.
   */
  attach?: { plan: AttachPlan; files: readonly PrepFile[] | "load" };
};

/** A refusal of the request itself (not a duplicate, not a rate limit): the one case the email is re-posted without its files. */
const ATTACHMENT_REFUSALS: readonly number[] = [400, 413, 422];
/**
 * A refusal that plausibly means the FILES were refused (a bad request, too large, unprocessable): the one case the email is re-posted
 * without them. A 401 / 403 (the key, or a sender the account has not verified), 408, 409 or 429 is a plain failure or retry, never "the mail
 * service refused attachments".
 */
const refusedWithFiles = (r: InternalMailResult): boolean => r.status === "failed" && r.http !== null && ATTACHMENT_REFUSALS.includes(r.http);

/** Approvals as one run sees it, read once: the pending and approved items. `none`: no queue (or no reader), so nothing to reuse. */
type Approvals = { state: "ok"; items: QueueItem[] } | { state: "none" } | { state: "unavailable" };

function approvalsReader(ctx: AgentContext): () => Promise<Approvals> {
  let memo: Promise<Approvals> | null = null;
  return () =>
    (memo ??= (async (): Promise<Approvals> => {
      // No queue, or no reader wired for it, is "nothing in Approvals". A reader that rejects is "couldn't read": never "none".
      if (!ctx.queueOrgKey || (!ctx.listPending && !ctx.listApproved)) return { state: "none" };
      try {
        const [pending, approved] = await Promise.all([ctx.listPending ? ctx.listPending() : [], ctx.listApproved ? ctx.listApproved() : []]);
        return { state: "ok", items: [...pending, ...approved] };
      } catch {
        return { state: "unavailable" };
      }
    })());
}

type Adoption = { state: "none" } | { state: "found"; item: QueueItem } | { state: "unavailable" };

/** The lead's stage-entered time, when a candidate has no booking time of its own. A failed read is "not known" (the day's start alone is then used). */
async function stageEnteredAt(admin: SupabaseClient, orgId: string, leadId: string): Promise<string | null> {
  try {
    const res = await leadRead(({ live }) => live(admin.from("crm_lead").select("id, stage_entered_at")).eq("org_id", orgId).eq("id", leadId).limit(1));
    if (res.error) return null;
    return ((res.data ?? [])[0] as { stage_entered_at?: string | null } | undefined)?.stage_entered_at ?? null;
  } catch {
    return null;
  }
}

type Mailer = {
  recipients: () => Promise<RecipientsRead>;
};

/** What a run knows about the sends: the folded records, how many times each slot was cancelled, and the leads a scoped run is limited to. */
type RunState = {
  folded: Map<string, SendRecord>;
  /** Cancelled rows per slot. A send planned again after a cancel carries `:g<n>` in its idempotency key, so Resend never answers with the cancelled email. */
  gens: Map<string, number>;
  scopedIds: readonly string[] | undefined;
  tz: string;
};

const generationsOf = (records: readonly SendRecord[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const r of records) if (r.status === "cancelled") out.set(recordSlot(r.prepKey, r.kind), (out.get(recordSlot(r.prepKey, r.kind)) ?? 0) + 1);
  return out;
};

const sha = (g: Pick<GuardResult, "to" | "cc">): string | null => (g.to.length === 0 ? null : recipientsSha256(g.to, g.cc));

/** Sends (or schedules) what a plan says, each recorded. Every skip is counted. */
async function deliver(
  ctx: AgentContext,
  deps: PrepDeps,
  mailer: Mailer,
  counts: Counts,
  state: RunState,
  g: Gathered,
  c: Candidate,
  actions: readonly SendAction[],
  content: PrepContent,
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
  const listHash = recipientsSha256(guarded.to, guarded.cc);
  // Replies go to a real firm mailbox (the sender may not be one), and only to one that passes the same rule as a Cc.
  const replyTo = deps.mail.replyTo ? guardReplyTo({ replyTo: deps.mail.replyTo, from, to: guarded.to, clientAddresses: g.clientAddresses }) : null;
  if (deps.mail.replyTo && !replyTo) counts.replyToRefused += 1;
  // The files, once for all of this prep's emails in this call: the bytes built now, or the saved copies read back.
  let files: readonly PrepFile[] = [];
  let loadFailed = false;
  if (content.adopted && content.attach) {
    if (content.attach.files === "load") {
      const loaded = deps.files ? await deps.files.load({ leadId: g.lead.id, prepKey: c.key }) : ({ state: "unavailable" } as const);
      if (loaded.state === "ok") files = loaded.files;
      else loadFailed = true;
    } else files = content.attach.files;
  }
  for (const action of actions) {
    // An email carries a FULL brief: the adopted item's text. A facts-only brief is sent only as the 1 h email, marked as such (the plan
    // never offers it anything else; this refuses it again, so a facts email can never go out as a booked or 24 h one).
    if (!content.adopted && action.kind !== "1h") continue;
    // The emailed copy is a pure function of the facts (no "Prepared" time), so a re-posted send under the same key carries the same payload.
    const briefFacts = { lead: g.facts.lead, startsAt: g.facts.startsAt, tz: g.facts.tz, send: action.kind };
    const fromSaved = content.attach?.files === "load";
    const withFiles = content.adopted && content.attach ? attachmentsForEmail(content.attach.plan, files, { loadFailed, fromSaved }) : null;
    const brief = content.adopted
      ? renderAdoptedBrief(content.adopted, briefFacts, withFiles?.lines)
      : renderConsultBrief({ ...g.facts, send: action.kind, factsOnly: true }, { prepared: false });
    const quality: BriefQuality = content.adopted ? "full" : "facts";
    const scheduledFor = action.mode === "schedule" ? action.at : null;
    const gen = state.gens.get(recordSlot(c.key, action.kind)) ?? 0;
    const key = `consult-prep:${ctx.orgId}:${c.key}:${action.kind}${gen > 0 ? `:g${gen}` : ""}`;
    const mail = (b: { subject: string; text: string; html: string }, idempotencyKey: string, attachments: readonly PrepFile[]) =>
      deps.mailOut({
        apiKey,
        from,
        to: guarded.to,
        ...(guarded.cc.length > 0 ? { cc: guarded.cc } : {}),
        ...(replyTo ? { replyTo } : {}),
        subject: b.subject,
        text: b.text,
        html: b.html,
        idempotencyKey,
        ...(scheduledFor ? { scheduledAt: scheduledFor } : {}),
        ...(attachments.length > 0 ? { attachments: attachments.map((f) => ({ filename: f.fileName, content: f.bytes })) } : {}),
        label: "consult-prep",
      });
    let result = await mail(brief, key, withFiles?.attach ?? []);
    if (withFiles && withFiles.attach.length > 0 && refusedWithFiles(result)) {
      // The mail service refused the email WITH its files: it is posted ONCE more without them, and the body names each one as missing.
      // A distinct key (`:noatt`): whether Resend keeps the key of a refused request is not verified, and reusing it could be answered
      // with the refusal again. A refused request was not accepted, so the second post cannot double a delivered email.
      counts.attachRefused += 1;
      const bare = attachmentsForEmail(content.attach!.plan, files, { refused: true, loadFailed, fromSaved });
      result = await mail(renderAdoptedBrief(content.adopted!, briefFacts, bare.lines), `${key}:noatt`, []);
    }
    // HTTP 409 from Resend = this key is already handled (another run got there first): done, never a failure.
    const duplicate = result.status === "failed" && result.http === 409;
    const status: SendStatus = result.status === "sent" ? (action.mode === "schedule" ? "scheduled" : "sent") : duplicate ? "duplicate" : "failed";
    if (result.status === "sent") {
      if (status === "scheduled") counts.scheduled += 1;
      else counts.sent += 1;
      if (quality === "facts") counts.factsOnly += 1;
    } else if (duplicate) counts.duplicate += 1;
    else counts.sendFailed += 1;
    const written = await writeSendRecord(ctx.admin, ctx.orgId, g.lead.id, {
      prepKey: c.key,
      kind: action.kind,
      resendId: result.status === "sent" ? (result.id ?? null) : null,
      scheduledFor,
      status,
      recipientsSha256: listHash,
      ...(quality === "facts" ? { quality } : {}),
      ...(status === "failed" && result.status === "failed" && result.http === null ? { noResponse: true } : {}),
    });
    if (!written) counts.unrecorded += 1;
  }
}

type FullPrep = {
  text: string;
  itemId: string;
  /** Not yet recorded on the lead: the marker still has to be written. */
  isNew: boolean;
  /** S2b: this assistant built it; what became of its files. Absent = adopted (a person's or the skill's): no files. */
  built?: AttachPlan;
  /** S2b: the files built in THIS run (a retry); absent = read the saved copies back. */
  files?: readonly PrepFile[];
};

/** What a prep's emails carry, from its full brief (or the facts brief when there is none). */
const contentOf = (full: FullPrep | null): PrepContent =>
  full ? { adopted: full.text, ...(full.built ? { attach: { plan: full.built, files: full.files ?? "load" } } : {}) } : { adopted: null };

/**
 * Records, once per slot, an email that is OWED but not sent because the prep only has the facts brief. A slot that is already
 * withheld (or failed, which is retried by its own rule) gets nothing new. A person's re-run never owes one: its booked email waits for
 * the full build (S2b) and nothing later comes back to it.
 */
async function recordWithheld(ctx: Pick<AgentContext, "admin" | "orgId">, counts: Counts, state: RunState, c: Candidate, kinds: readonly SendKind[]): Promise<void> {
  if (c.rerun) return;
  for (const kind of kinds) {
    const slot = recordSlot(c.key, kind);
    const have = state.folded.get(slot);
    if (have && (have.status === "withheld" || have.status === "failed")) continue;
    const ok = await writeSendRecord(ctx.admin, ctx.orgId, c.leadId, { prepKey: c.key, kind, resendId: null, scheduledFor: null, status: "withheld" });
    if (ok) {
      counts.withheld += 1; // counted only when a new row is written
      state.folded.set(slot, { leadId: c.leadId, prepKey: c.key, kind, resendId: null, scheduledFor: null, status: "withheld", at: new Date().toISOString() });
    } else counts.unrecorded += 1;
  }
}

/** A prep that found its full brief AFTER it was made (or whose adopted item changed): the marker says which Approvals item the card and the emails now use. */
/**
 * S2c: records, once per slot, an email Lectual does NOT send because lawmatics-mcp may already have scheduled its own brief for this
 * consult. The row is never owed again (`planSends` treats it as done), so no later run sends it, whatever the clock or the env says.
 */
async function recordSuperseded(ctx: Pick<AgentContext, "admin" | "orgId">, counts: Counts, state: RunState, c: Candidate, kinds: readonly SendKind[]): Promise<void> {
  for (const kind of kinds) {
    const slot = recordSlot(c.key, kind);
    if (state.folded.get(slot)?.status === "superseded") continue;
    const ok = await writeSendRecord(ctx.admin, ctx.orgId, c.leadId, { prepKey: c.key, kind, resendId: null, scheduledFor: null, status: "superseded" });
    if (ok) {
      counts.superseded += 1;
      state.folded.set(slot, { leadId: c.leadId, prepKey: c.key, kind, resendId: null, scheduledFor: null, status: "superseded", at: new Date().toISOString() });
    } else counts.unrecorded += 1;
  }
}

async function writeAdoptMarker(admin: SupabaseClient, orgId: string, c: Candidate, itemId: string, built?: AttachPlan): Promise<boolean> {
  const { error } = await admin.from("crm_activity").insert({
    org_id: orgId,
    lead_id: c.leadId,
    type: "queue_drafted",
    actor_id: null,
    actor_type: "ai",
    payload: {
      source: PREP_SOURCE,
      agent: PREP_SOURCE,
      kind: PREP_BRIEF_KIND,
      event_id: markerEventId(c.baseKey),
      prep_key: c.key,
      ...(c.event ? { start_at: c.event.startsAt } : {}),
      queueItemId: itemId,
      // S2b: a full prep this assistant built after the facts brief (a retry) is `full`, with what became of its files; else adopted.
      ...(built ? { full: true, attach: built } : { adopted: true }),
    },
  });
  return !error;
}

/**
 * S2b: the full builds tried for one prep key, from the `ai_insight` rows `consult-prep-build` (ids, codes and times only). Every attempt
 * writes a `started` row BEFORE the model is called, and a queued full brief writes a `queued` row with its Approvals item id. So:
 *   - a prep is never built more than MAX_BUILD_ATTEMPTS times (a model that keeps failing, or a marker that keeps failing to write);
 *   - a full brief that was queued but whose marker did not land is found again here and its marker written, with no rebuild.
 * Null = couldn't be read: no build on a guess.
 */
export const MAX_BUILD_ATTEMPTS = 3;
type PriorBuilds = { attempts: number; queued: { itemId: string; attach: AttachPlan } | null };

async function readPriorBuilds(admin: SupabaseClient, orgId: string, leadId: string, prepKey: string): Promise<PriorBuilds | null> {
  try {
    const { data, error } = await admin
      .from("crm_activity")
      .select("created_at, payload")
      .eq("org_id", orgId)
      .eq("lead_id", leadId)
      .eq("type", "ai_insight")
      .eq("payload->>source", PREP_BUILD_SOURCE)
      .eq("payload->>prep_key", prepKey)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return null;
    const out: PriorBuilds = { attempts: 0, queued: null };
    for (const row of (data ?? []) as Array<{ payload: Record<string, unknown> | null }>) {
      const p = row.payload ?? {};
      if (p.status === "started") out.attempts += 1;
      else if (p.status === "queued" && typeof p.queue_item_id === "string" && !out.queued) out.queued = { itemId: p.queue_item_id, attach: parseAttachPlan(p.attach) };
    }
    return out;
  } catch {
    return null;
  }
}

async function writeBuildRow(admin: SupabaseClient, orgId: string, leadId: string, payload: Record<string, unknown>): Promise<boolean> {
  const { error } = await admin.from("crm_activity").insert({ org_id: orgId, lead_id: leadId, type: "ai_insight", actor_id: null, actor_type: "ai", payload: { source: PREP_BUILD_SOURCE, ...payload } });
  return !error;
}

// ── cancel ───────────────────────────────────────────────────────────────────

/** The scheduled sends (still in the future) a run may touch: a scoped run touches only its own leads'. */
function scheduledIn(state: RunState, nowMs: number): SendRecord[] {
  return [...state.folded.values()].filter(
    (r) => r.status === "scheduled" && (!r.scheduledFor || Date.parse(r.scheduledFor) > nowMs) && (!state.scopedIds || (r.leadId !== null && state.scopedIds.includes(r.leadId))),
  );
}

const leadOfRecord = (r: SendRecord): string | null => r.leadId ?? parsePrepKey(r.prepKey)?.leadId ?? null;

/** Cancels one scheduled send with Resend, then records it. True when it was cancelled. */
async function cancelOne(ctx: Pick<AgentContext, "admin" | "orgId">, deps: PrepDeps, counts: Counts, state: RunState, record: SendRecord, nowMs: number): Promise<boolean> {
  if (!record.resendId || !deps.mail.apiKey) {
    counts.cancelUnchecked += 1;
    return false;
  }
  const res = await deps.mailCancel({ apiKey: deps.mail.apiKey, id: record.resendId, label: "consult-prep" });
  if (res.status !== "cancelled") {
    counts.sendFailed += 1;
    return false;
  }
  counts.cancelled += 1;
  const leadId = leadOfRecord(record);
  const ok = leadId
    ? await writeSendRecord(ctx.admin, ctx.orgId, leadId, { prepKey: record.prepKey, kind: record.kind, resendId: record.resendId, scheduledFor: record.scheduledFor, status: "cancelled", recipientsSha256: record.recipientsSha256 })
    : false;
  if (!ok) {
    // The email is cancelled at Resend but the row saying so was not written: the slot is NOT treated as cancelled, so nothing is planned
    // again under a key the generation count has not moved past (a re-plan would reuse the cancelled email's key).
    counts.unrecorded += 1;
    return false;
  }
  // The slot is no longer done: a later plan in this run sees it as cancelled, and a new send for it gets a new idempotency key.
  const slot = recordSlot(record.prepKey, record.kind);
  state.folded.set(slot, { ...record, status: "cancelled", at: new Date(nowMs).toISOString() });
  state.gens.set(slot, (state.gens.get(slot) ?? 0) + 1);
  return true;
}

/**
 * Cancels EVERY still-scheduled send of a firm (the consult-prep setting is off: nothing more should go out). No prep is made.
 * An unreadable or cut-short send history throws; a cancel Resend refuses is counted, not hidden.
 */
export async function cancelAllScheduled(ctx: Pick<AgentContext, "admin" | "orgId">, deps: PrepDeps, nowMs: number): Promise<{ cancelled: number; notCancelled: number }> {
  const counts = emptyCounts();
  const records = await readSendRecords(ctx.admin, ctx.orgId, nowMs);
  const state: RunState = { folded: foldSendRecords(records), gens: generationsOf(records), scopedIds: undefined, tz: "UTC" };
  for (const r of scheduledIn(state, nowMs)) await cancelOne(ctx, deps, counts, state, r, nowMs);
  return { cancelled: counts.cancelled, notCancelled: counts.cancelUnchecked + counts.sendFailed };
}

/** The event a scheduled send was made for changed or went (unless the same call is still on the calendar under another id). */
async function cancelChanged(ctx: AgentContext, deps: PrepDeps, counts: Counts, state: RunState, nowMs: number): Promise<void> {
  const scheduled = scheduledIn(state, nowMs);
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
  // A send whose event id vanished may still be right: the same call booked in Lawmatics AND on Outlook is two rows. Look for a twin.
  const missing = scheduled.filter((r) => {
    const p = parsePrepKey(r.prepKey);
    return p && p.kind === "event" && !now.get(p.eventId);
  });
  const twins: Array<{ id: string; lead_id: string | null; starts_at: string }> = [];
  let twinsUnread = false;
  if (missing.length > 0) {
    const starts = missing.map((r) => Date.parse((parsePrepKey(r.prepKey) as { startsAt: string }).startsAt)).filter(Number.isFinite);
    const leads = [...new Set(missing.map((r) => leadOfRecord(r)).filter((x): x is string => !!x))];
    const margin = 60 * 60_000;
    for (const batch of chunk(leads, IN_CHUNK)) {
      const res = await ctx.admin
        .from("crm_calendar_event")
        .select("id, lead_id, starts_at")
        .eq("org_id", ctx.orgId)
        .eq("is_consult", true)
        .in("lead_id", batch)
        .gte("starts_at", new Date(Math.min(...starts) - margin).toISOString())
        .lte("starts_at", new Date(Math.max(...starts) + margin).toISOString())
        .limit(MARKER_ROWS);
      if (res.error || (res.data ?? []).length >= MARKER_ROWS) {
        twinsUnread = true;
        break;
      }
      twins.push(...((res.data ?? []) as Array<{ id: string; lead_id: string | null; starts_at: string }>));
    }
  }
  for (const record of scheduled) {
    const parsed = parsePrepKey(record.prepKey);
    if (!parsed || parsed.kind !== "event") continue;
    const event = now.get(parsed.eventId) ?? null;
    if (!event && twinsUnread) {
      counts.cancelUnchecked += 1;
      continue;
    }
    const twinExists = !event && twins.some((t) => t.id !== parsed.eventId && sameLeadSameTime({ leadId: t.lead_id, startsAt: t.starts_at }, { leadId: parsed.leadId, startsAt: parsed.startsAt }));
    if (!shouldCancel(record, event, { twinExists })) continue;
    await cancelOne(ctx, deps, counts, state, record, nowMs);
  }
}

/** A lead that moved into a lost or nurture stage, or was merged, no longer wants its reminders. */
async function cancelLeftLeads(ctx: AgentContext, deps: PrepDeps, counts: Counts, state: RunState, nowMs: number): Promise<void> {
  const scheduled = scheduledIn(state, nowMs);
  if (scheduled.length === 0) return;
  let stages: StageOpt[];
  try {
    stages = await readStages(ctx.admin, ctx.orgId);
  } catch {
    counts.cancelUnchecked += scheduled.length;
    return;
  }
  const category = new Map(stages.map((s) => [s.id, s.category]));
  const leadIds = [...new Set(scheduled.map(leadOfRecord).filter((x): x is string => !!x))];
  const stageOfLive = new Map<string, string | null>();
  for (const batch of chunk(leadIds, IN_CHUNK)) {
    const res = await leadRead(({ live }) => live(ctx.admin.from("crm_lead").select("id, current_stage_id")).eq("org_id", ctx.orgId).in("id", batch));
    if (res.error) {
      counts.cancelUnchecked += scheduled.length;
      return;
    }
    for (const r of (res.data ?? []) as Array<{ id: string; current_stage_id: string | null }>) stageOfLive.set(r.id, r.current_stage_id);
  }
  for (const record of scheduled) {
    const leadId = leadOfRecord(record);
    if (!leadId) continue;
    const gone = !stageOfLive.has(leadId); // merged into another lead (or no longer there)
    const cat = category.get(stageOfLive.get(leadId) ?? "");
    if (!gone && cat !== "lost" && cat !== "nurture") continue;
    if (await cancelOne(ctx, deps, counts, state, record, nowMs)) counts.leftCancelled += 1;
  }
}

/**
 * A scheduled send carries the hash of the list it was made for. When who gets consult prep changes, a still-scheduled send is
 * cancelled (the candidate loop then plans it again with the current list). An unreadable recipient list cancels nothing.
 */
async function cancelStaleRecipients(ctx: AgentContext, deps: PrepDeps, counts: Counts, state: RunState, mailer: Mailer, nowMs: number): Promise<void> {
  const scheduled = scheduledIn(state, nowMs).filter((r) => r.recipientsSha256 && r.resendId);
  if (scheduled.length === 0) return;
  const recipients = await mailer.recipients();
  if (recipients.state === "unreadable") return;
  const emails = new Map<string, string | null>();
  if (recipients.state === "ok") {
    const leadIds = [...new Set(scheduled.map(leadOfRecord).filter((x): x is string => !!x))];
    for (const batch of chunk(leadIds, IN_CHUNK)) {
      const res = await leadRead(({ live }) => live(ctx.admin.from("crm_lead").select("id, email")).eq("org_id", ctx.orgId).in("id", batch));
      if (res.error) {
        counts.cancelUnchecked += scheduled.length;
        return;
      }
      for (const r of (res.data ?? []) as Array<{ id: string; email: string | null }>) emails.set(r.id, r.email);
    }
  }
  const full = new Map<string, Promise<Gathered | null>>();
  for (const record of scheduled) {
    const leadId = leadOfRecord(record);
    if (!leadId) continue;
    if (recipients.state === "ok") {
      // Cheap check with the lead's own address; only a difference is confirmed with everything the guard knows about the client.
      const cheap = sha(guardRecipients({ to: recipients.to, cc: recipients.cc, clientAddresses: [emails.get(leadId)] }));
      if (cheap === record.recipientsSha256) continue;
      if (!full.has(leadId)) full.set(leadId, gather(ctx.admin, ctx.orgId, { key: record.prepKey, baseKey: record.prepKey, leadId, event: null, rerun: false, bookedAt: null }, nowMs, state.tz, deps, null).catch(() => null));
      const g = await full.get(leadId)!;
      if (!g) {
        counts.cancelUnchecked += 1;
        continue;
      }
      if (sha(guardRecipients({ to: recipients.to, cc: recipients.cc, clientAddresses: g.clientAddresses })) === record.recipientsSha256) continue;
    }
    if (await cancelOne(ctx, deps, counts, state, record, nowMs)) counts.recipientsChanged += 1;
  }
}

// ── the run ──────────────────────────────────────────────────────────────────

type Ev = EventRow & { leadId: string; startsAt: string };

/** One Lawmatics client for the whole run, so the account's field list is read once (see `readFieldMeta`). */
function memoProspects(reader: ProspectReader): ProspectReader {
  let memo: ReturnType<ProspectReader["client"]> | null = null;
  return { client: () => (memo ??= reader.client()) };
}

export async function runPrep(ctx: AgentContext, rawDeps: PrepDeps, generate: DraftTextGenerator): Promise<AgentResult> {
  const deps: PrepDeps = { ...rawDeps, prospects: memoProspects(rawDeps.prospects) };
  const { admin, orgId, autonomy } = ctx;
  const nowMs = ctx.now();
  const scope = ctx.scope;
  const scopedIds = scope?.leadIds && scope.leadIds.length > 0 ? scope.leadIds : undefined;
  if (scope?.leadIds && scope.leadIds.length === 0) return skipped("Skipped: no lead was named for this prep.");
  const rerunRun = scope?.reason === "rerun";
  const outlook = mailboxModuleState(ctx) === "on";
  const counts = emptyCounts();
  counts.leadsOver = scope?.reason === "stage" ? (scope.over ?? 0) : 0;

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
  const liveEvents: Ev[] = calendar.rows.filter((e) => live.has(e.lead_id as string)).map((e) => ({ ...e, leadId: e.lead_id as string, startsAt: e.starts_at }));

  // What is already done: prep markers. Unreadable ends the run (a guess could prep twice).
  const markers = await readMarkers(admin, orgId, liveEvents.map((e) => e.id));
  // One call booked twice (Lawmatics and Outlook) is ONE candidate: the twin that already has a marker, else the Lawmatics row.
  const collapsed = collapseTwins(liveEvents, (e) => markers.byKey.has(eventPrepKey(e.leadId, e.id, e.starts_at)) || markers.legacyEvents.has(e.id));
  counts.twins += collapsed.dropped;
  const events = collapsed.kept;
  const withConsult = new Set(events.map((e) => e.leadId));
  const leadMarkers = await readLeadMarkers(admin, orgId, [...withConsult]);

  const candidates: Candidate[] = events.map((e) => {
    const base = eventPrepKey(e.leadId, e.id, e.starts_at);
    return { key: rerunRun ? rerunKey(base, nowMs) : base, baseKey: base, leadId: e.leadId, event: { id: e.id, startsAt: normalizedStart(e.starts_at) ?? e.starts_at, joinUrl: e.join_url }, rerun: rerunRun, bookedAt: e.created_at ?? null };
  });

  let stageUnread = false;
  let stageList: StageOpt[] | null = null;
  try {
    const [stages, mapping] = await Promise.all([readStages(admin, orgId), readMapping(admin, orgId)]);
    stageList = stages;
    const stage = consultScheduledStage(stages, mapping);
    if (stage) {
      const leads = await readStageLeads(admin, orgId, stage.id, rerunRun ? null : nowMs - STAGE_WINDOW_MS, scopedIds);
      // A lead with ANY future consult event (not only one inside the 14-day window) is prepped by that consult, never by its stage.
      const future = await leadsWithFutureConsult(admin, orgId, leads.map((l) => l.id).filter((id) => !withConsult.has(id)), nowMs);
      const found: Candidate[] = [];
      for (const lead of leads) {
        if (withConsult.has(lead.id) || future.has(lead.id)) continue;
        const rowId = (await newestStageRow(admin, orgId, lead.id, stage.id)) ?? lead.stageEnteredAt;
        if (!rowId) continue;
        const base = stagePrepKey(lead.id, rowId);
        found.push({ key: rerunRun ? rerunKey(base, nowMs) : base, baseKey: base, leadId: lead.id, event: null, rerun: rerunRun, bookedAt: lead.stageEnteredAt });
      }
      const stageMarkers = await readMarkers(admin, orgId, found.map((c) => markerEventId(c.baseKey)).filter((x): x is string => !!x));
      for (const [k, v] of stageMarkers.byKey) markers.byKey.set(k, v);
      for (const [k, v] of stageMarkers.adopted) markers.adopted.set(k, v);
      for (const [k, v] of stageMarkers.built) markers.built.set(k, v);
      for (const id of stageMarkers.legacyEvents) markers.legacyEvents.add(id);
      candidates.push(...found);
    }
  } catch {
    stageUnread = true;
  }

  // Send records (unreadable or cut short ends the run: a guess could send twice).
  const records = await readSendRecords(admin, orgId, nowMs, scopedIds);
  const state: RunState = { folded: foldSendRecords(records), gens: generationsOf(records), scopedIds, tz: "UTC" };
  // S2c: how far lawmatics-mcp can have scheduled its own briefs before it was switched off (null = no cutover rule).
  const reach: CutoverReach | null = typeof deps.cutoverAtMs === "number" && Number.isFinite(deps.cutoverAtMs) ? lawmaticsReach(deps.cutoverAtMs) : null;
  const style = await readFirmStyle(admin, orgId);
  state.tz = style.timeZone;

  let recipientsCache: Promise<RecipientsRead> | null = null;
  const mailer: Mailer = { recipients: () => (recipientsCache ??= readRecipients(admin, orgId, deps)) };

  // Cancel what a change made wrong, before anything new is scheduled: the consult moved or went, the lead left, who gets the email changed.
  await cancelChanged(ctx, deps, counts, state, nowMs);
  await cancelLeftLeads(ctx, deps, counts, state, nowMs);
  await cancelStaleRecipients(ctx, deps, counts, state, mailer, nowMs);
  const folded = state.folded;

  // A lead in a lost or nurture stage is not prepped and gets no reminders planned again.
  const leftIds = new Set<string>();
  if (stageList) {
    const cat = new Map(stageList.map((s) => [s.id, s.category]));
    const stageOf = await leadStages(admin, orgId, [...new Set(candidates.map((c) => c.leadId))]);
    for (const [id, stageId] of stageOf) {
      const k = cat.get(stageId ?? "");
      if (k === "lost" || k === "nurture") leftIds.add(id);
    }
  }
  const standing = candidates.filter((c) => !leftIds.has(c.leadId));
  counts.leftSkipped += candidates.length - standing.length;

  if (standing.length === 0) {
    const parts = ["No consults need prep."];
    if (counts.leadsOver > 0) parts.push(`${plural(counts.leadsOver, "more lead", "more leads")} entered the stage in the same request and ${counts.leadsOver === 1 ? "is" : "are"} left for the next sweep.`);
    if (counts.cancelled > 0) parts.push(`${plural(counts.cancelled, "reminder", "reminders")} cancelled.`);
    if (counts.leftCancelled > 0) parts.push(`${plural(counts.leftCancelled, "reminder", "reminders")} cancelled because the lead left the pipeline.`);
    if (counts.recipientsChanged > 0) parts.push(`${plural(counts.recipientsChanged, "reminder", "reminders")} cancelled because who gets consult prep changed.`);
    if (counts.cancelUnchecked > 0) parts.push(`${plural(counts.cancelUnchecked, "scheduled email", "scheduled emails")} could not be checked against the calendar.`);
    if (counts.sendFailed > 0) parts.push(`${plural(counts.sendFailed, "email", "emails")} could not be sent or cancelled and will be tried again.`);
    if (stageUnread) parts.push("The consult stage could not be read, so leads were not checked by stage.");
    if (calendar.outlookNotReady) parts.push("The Outlook calendar isn't switched on for your firm yet.");
    if (mailboxModuleState(ctx) === "unreadable") parts.push(`Outlook consults were not read: ${MAILBOX_GATE_REASON.unreadable}.`);
    return { itemsIn: 0, draftsOut: 0, summary: parts.join(" ") };
  }

  const templateOn = agentToolkitModuleState(ctx) === "on";
  let newPreps = 0;
  let reminders = 0;

  // Approvals, read once per run and only when a prep needs it. Which item belongs to which lead is the queue's own resolver's answer.
  const approvals = approvalsReader(ctx);
  const resolvedCache = new Map<string, Resolved>();
  const adoptionFor = async (c: Candidate): Promise<Adoption> => {
    const a = await approvals();
    if (a.state === "none") return { state: "none" };
    if (a.state === "unavailable") return { state: "unavailable" };
    const booked = c.bookedAt ?? (await stageEnteredAt(admin, orgId, c.leadId));
    const candidates = adoptableItems(a.items, adoptionSinceMs(booked, nowMs, style.timeZone));
    if (candidates.length === 0) return { state: "none" };
    const unresolved = candidates.filter((i) => !resolvedCache.has(i.id));
    if (unresolved.length > 0) {
      try {
        const resolved = await resolveBatch(orgFencedReader(admin, orgId), unresolved);
        for (const i of unresolved) resolvedCache.set(i.id, resolved.get(i.id) ?? { leadIds: [], kind: null });
      } catch {
        return { state: "unavailable" };
      }
    }
    const item = pickAdoption(candidates, resolvedCache, c.leadId);
    return item ? { state: "found", item } : { state: "none" };
  };
  /** A prep that already exists: the item it adopted if that is still in Approvals, else whatever full prep is there now. */
  const fullForPrepped = async (c: Candidate, adoptedId: string | undefined): Promise<{ state: "unavailable" } | { state: "ok"; full: FullPrep | null; adoptedGone: boolean }> => {
    const a = await approvals();
    if (a.state === "unavailable") return { state: "unavailable" };
    let adoptedGone = false;
    if (a.state === "ok" && adoptedId) {
      const builtPlan = markers.built.get(c.key) ?? undefined;
      const hit = stillAdoptable(a.items, adoptedId, { built: !!builtPlan });
      if (hit) return { state: "ok", full: { text: itemText(hit), itemId: hit.id, isNew: false, built: builtPlan }, adoptedGone: false };
      adoptedGone = true; // read fine, and the item it adopted is rejected, edited into something else, or no longer there
    }
    const found = await adoptionFor(c);
    if (found.state === "unavailable") return { state: "unavailable" };
    return { state: "ok", full: found.state === "found" ? { text: itemText(found.item), itemId: found.item.id, isNew: found.item.id !== adoptedId } : null, adoptedGone };
  };
  /** S2b: the full build, with its failure counted by reason. Null = no builder wired, or the build failed (the brief stays facts). */
  const buildFull = async (facts: BriefFacts): Promise<Extract<FullBuild, { ok: true }> | null> => {
    if (!deps.full) return null;
    const built = await deps.full(facts);
    if (built.ok) return built;
    counts.fullFailed[built.reason] = (counts.fullFailed[built.reason] ?? 0) + 1;
    return null;
  };
  /** S2b (a retry): build the full prep and keep its text in Approvals, where every later email reads it. */
  const buildAndQueue = async (g: Gathered, key: string): Promise<FullPrep | null> => {
    const built = await buildFull(g.facts);
    if (!built || !ctx.queueOrgKey) return null;
    const text = renderConsultBrief({ ...g.facts, full: built.sections }).text;
    const shownName = scrubJudgmentContent(cardName(g.lead));
    try {
      const item = await ctx.createDraft({
        orgKey: ctx.queueOrgKey,
        agent: PREP_SOURCE,
        type: "BRIEFING",
        headline: `Consult prep for ${shownName}`,
        summary: FULL_SUMMARY(shownName),
        draftBody: text,
        clientName: cardName(g.lead),
        leadId: g.lead.id,
      });
      counts.fullBuilt += 1;
      counts.drafts += 1;
      await writeBuildRow(admin, orgId, g.lead.id, { prep_key: key, status: "queued", queue_item_id: item.id, attach: built.attachPlan });
      return { text, itemId: item.id, isNew: true, built: built.attachPlan, files: built.files };
    } catch {
      counts.fullFailed.unexpected = (counts.fullFailed.unexpected ?? 0) + 1;
      return null;
    }
  };
  /**
   * S2b: may this prep key try the full build now? `repair`: a full brief was queued on an earlier run (its marker never landed): use it,
   * nothing is rebuilt. `go`: a `started` row was written, so the attempt counts. `no`: unreadable, capped, or the row couldn't be written.
   */
  const buildGate = async (c: Candidate): Promise<{ kind: "go" } | { kind: "no" } | { kind: "repair"; itemId: string; attach: AttachPlan }> => {
    const prior = await readPriorBuilds(admin, orgId, c.leadId, c.key);
    if (!prior) {
      counts.fullFailed.unexpected = (counts.fullFailed.unexpected ?? 0) + 1;
      return { kind: "no" };
    }
    if (prior.queued) return { kind: "repair", ...prior.queued };
    if (prior.attempts >= MAX_BUILD_ATTEMPTS) {
      counts.buildCapped += 1;
      return { kind: "no" };
    }
    if (!(await writeBuildRow(admin, orgId, c.leadId, { prep_key: c.key, status: "started" }))) {
      counts.fullFailed.unexpected = (counts.fullFailed.unexpected ?? 0) + 1;
      return { kind: "no" };
    }
    return { kind: "go" };
  };
  /** S2b: the full prep's files to the lead's Documents & files, once per prep key. Never throws into the run. */
  const saveFiles = async (c: Candidate, files: readonly PrepFile[]): Promise<void> => {
    if (!deps.files || files.length === 0) return;
    try {
      const out = await deps.files.save({ leadId: c.leadId, prepKey: c.key, files });
      counts.filesSaved += out.saved;
      counts.filesSkipped += out.skipped;
      counts.filesFailed += out.failed;
      counts.filesUnlogged += out.unlogged ?? 0;
    } catch {
      counts.filesFailed += files.length;
    }
  };
  for (const c of standing) {
    if (budgetNearlySpent(ctx, NO_NEW_ITEM_RESERVE_MS)) {
      counts.deferred += 1;
      continue;
    }
    const existing = new Map(folded);
    const preppedAt = c.rerun ? undefined : markers.byKey.get(c.key);
    const legacy = !c.rerun && c.event !== null && markers.legacyEvents.has(c.event.id);
    const startMs = c.event ? Date.parse(c.event.startsAt) : null;
    try {
      if (preppedAt !== undefined || legacy) {
        // Already prepped: only what is still owed (a reminder inside Resend's window, a booked email that failed or was withheld).
        if (reminders >= REMINDER_BATCH) {
          counts.over += 1;
          continue;
        }
        // A prep from before the sends existed has no booked email to retry and made no promise about reminders it never planned.
        if (legacy) continue;
        const base = {
          prepKey: c.key,
          startsAtMs: startMs,
          nowMs,
          preppedAtMs: preppedAt !== undefined ? Date.parse(preppedAt) : nowMs - 24 * HOUR_MS - 1,
          madeNow: false,
          suppressBooked: false,
          cutover: c.rerun ? null : reach,
        };
        const adoptedId = markers.adopted.get(c.key);
        // A facts-only 1 h email that has not gone out yet (its time is still ahead). One whose time has passed is already sent: it stays.
        const factsScheduled = (["1h"] as const).some((k) => {
          const r = existing.get(recordSlot(c.key, k));
          return r?.status === "scheduled" && r.quality === "facts" && !!r.scheduledFor && Date.parse(r.scheduledFor) > nowMs;
        });
        // Is there anything a FULL brief would change? Nothing owed and nothing to upgrade: Approvals is not even read.
        const probe = planSends({ ...base, brief: "facts", existing });
        // S2c: what lawmatics-mcp covers is recorded now and never owed again (and is no reason to read Approvals or build).
        await recordSuperseded(ctx, counts, state, c, probe.superseded);
        if (probe.actions.length === 0 && probe.withheld.length === 0 && !factsScheduled && !adoptedId) continue;
        let full: FullPrep | null = null;
        let adoptedGone = false;
        let approvalsRead = false;
        if (!c.rerun) {
          const looked = await fullForPrepped(c, adoptedId);
          if (looked.state === "unavailable") {
            // Approvals could not be read: it is said, nothing is adopted and NOTHING is cancelled on a guess, and the plan below runs as with a
            // facts brief, so the facts-only 1 h email is not lost (a full prep that turns up later replaces it).
            counts.adoptionUnread += 1;
          } else {
            full = looked.full;
            adoptedGone = looked.adoptedGone;
            approvalsRead = true;
          }
        }
        // S2b: no full prep anywhere yet, and something a full one would send is still owed (a withheld booked or 24 h email, or a
        // facts-only 1 h email still waiting): try the full build again. It needs Approvals, where the full text is kept for every email.
        let retryGathered: Gathered | null = null;
        if (!c.rerun && !full && !adoptedGone && deps.full && ctx.queueOrgKey && approvalsRead) {
          // (No queue: a full brief can't be kept for a later email, so no build is tried; the facts brief stands.)
          const fullProbe = planSends({ ...base, brief: "full", existing });
          const wouldSend = fullProbe.actions.some((a) => a.kind !== "1h") || factsScheduled;
          if (wouldSend) {
            const gate = await buildGate(c);
            if (gate.kind === "repair") {
              // Built and queued before, but its marker never landed: that item is the full prep (when it is still in Approvals).
              const a = await approvals();
              const hit = a.state === "ok" ? stillAdoptable(a.items, gate.itemId, { built: true }) : null;
              if (hit) {
                full = { text: itemText(hit), itemId: hit.id, isNew: true, built: gate.attach };
                counts.repaired += 1;
              }
            } else if (gate.kind === "go") {
              retryGathered = await gather(admin, orgId, c, nowMs, style.timeZone, deps, null);
              if (retryGathered) full = await buildAndQueue(retryGathered, c.key);
            }
          }
        }
        // Sends still waiting at Resend that carry the wrong text are cancelled, and the plan below sends them again: a facts-only 1 h when a full brief
        // has turned up, and anything made from an adopted item that is now rejected or gone (it carries text nobody should rely on any more).
        let owed = existing;
        const stale = SEND_KINDS.map((k) => existing.get(recordSlot(c.key, k))).filter(
          (r): r is SendRecord => !!r && r.status === "scheduled" && !!r.scheduledFor && Date.parse(r.scheduledFor) > nowMs && ((!!full && r.quality === "facts") || (adoptedGone && r.quality !== "facts")),
        );
        for (const record of stale) {
          if (await cancelOne(ctx, deps, counts, state, record, nowMs)) {
            if (record.quality === "facts") counts.upgraded += 1;
            else counts.adoptedGone += 1;
            owed = new Map(state.folded);
          }
        }
        const plan = planSends({ ...base, brief: full ? "full" : "facts", existing: owed });
        await recordWithheld(ctx, counts, state, c, plan.withheld);
        await recordSuperseded(ctx, counts, state, c, plan.superseded);
        if (plan.actions.length === 0 && !full?.isNew) continue;
        if (plan.actions.length > 0) {
          reminders += 1;
          const g = retryGathered ?? (await gather(admin, orgId, c, nowMs, style.timeZone, deps, null));
          if (!g) {
            counts.failed += 1;
            continue;
          }
          await deliver(ctx, deps, mailer, counts, state, g, c, plan.actions, contentOf(full));
        }
        if (full?.files && full.files.length > 0) await saveFiles(c, full.files);
        if (full?.isNew && !(await writeAdoptMarker(admin, orgId, c, full.itemId, full.built))) counts.unrecorded += 1;
        continue;
      }

      // The same call already prepped under another event id (a twin that has since gone, or one this run did not keep): not prepped again.
      if (!c.rerun && c.event && hasTwinMarker(leadMarkers.filter((m) => m.eventId !== c.event?.id), c.leadId, c.event.startsAt)) {
        counts.twins += 1;
        continue;
      }
      if (newPreps >= PREP_BATCH) {
        counts.over += 1;
        continue;
      }
      // Before a NEW prep is built, a full one that is already in Approvals for this lead is reused (never for a person's re-run). An
      // Approvals that cannot be read is not "none found": this consult waits for the next run, and nothing is built on a guess.
      let adoption: QueueItem | null = null;
      if (!c.rerun) {
        const found = await adoptionFor(c);
        if (found.state === "unavailable") {
          counts.adoptionUnread += 1;
          continue;
        }
        if (found.state === "found") adoption = found.item;
      }
      // S2b: may the full prep be built? Only with a queue: the full text is kept in Approvals, where every later email of the prep reads
      // it. With no queue the prep is a facts prep (S2a), said in the summary. A full brief queued earlier whose marker never landed is
      // recorded now, and nothing is rebuilt or queued again.
      let mayBuild = false;
      if (!adoption && deps.full) {
        if (!ctx.queueOrgKey) counts.fullNoQueue += 1;
        else {
          const gate = await buildGate(c);
          if (gate.kind === "repair") {
            if (await writeAdoptMarker(admin, orgId, c, gate.itemId, gate.attach)) counts.repaired += 1;
            else counts.unrecorded += 1;
            continue;
          }
          mayBuild = gate.kind === "go";
        }
      }
      const g = await gather(admin, orgId, c, nowMs, style.timeZone, deps, counts);
      if (!g) {
        counts.failed += 1;
        continue;
      }
      const { lead, facts } = g;
      const name = cardName(lead);
      const shownName = scrubJudgmentContent(name);
      // Build and check BOTH drafts before queueing either. (An adopted prep is the firm's own text and has no facts brief to check.)
      // The guard reads the system's own FACTS wording; the full brief's judgment is the point of S2b and is checked by its own scrubbers.
      if (!adoption) assertNoJudgmentContent(briefOwnWording(facts), "consult prep brief");
      // S2b: a prep that adopted nothing builds the FULL brief (a person's re-run always does). A failure keeps the facts brief.
      let built = mayBuild ? await buildFull(facts) : null;
      let brief = renderConsultBrief(built ? { ...facts, full: built.sections } : facts);
      const address = realAddress(lead.email);
      let clientBody: string | null = null;
      // An adopted prep brings its own drafts: no second client email is written beside it.
      if (autonomy !== "suggest" && c.event && !adoption) {
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

      // Another run (another instance) may have made this very prep while this one was gathering: look again, right before the queue.
      // This narrows the race, it does not close it (two runs can still read "none" in the same instant; see AGENTS.md).
      if (!c.rerun) {
        const again = await readMarkers(admin, orgId, [markerEventId(c.baseKey)].filter((x): x is string => !!x));
        if (again.byKey.has(c.key)) {
          counts.alreadyPrepped += 1;
          continue;
        }
      }

      const queued: Array<{ kind: string; id: string | null; adopted?: true }> = [];
      let queueFailed = false;
      if (adoption) {
        queued.push({ kind: PREP_BRIEF_KIND, id: adoption.id, adopted: true });
      } else if (ctx.queueOrgKey) {
        try {
          const item = await ctx.createDraft({
            orgKey: ctx.queueOrgKey,
            agent: PREP_SOURCE,
            type: "BRIEFING",
            headline: `Consult prep for ${shownName}`,
            summary: built ? FULL_SUMMARY(shownName) : `Internal consult prep for ${shownName}: the facts on file, ready before the call. Prepared by the Consult prep assistant; nothing was sent to the client.`,
            draftBody: brief.text,
            clientName: name,
            leadId: lead.id,
          });
          queued.push({ kind: PREP_BRIEF_KIND, id: item.id });
          if (built) await writeBuildRow(admin, orgId, lead.id, { prep_key: c.key, status: "queued", queue_item_id: item.id, attach: built.attachPlan });
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
      if (built && !queued.some((q) => q.kind === PREP_BRIEF_KIND && q.id && !q.adopted)) {
        // The full brief could not be kept in Approvals: no later email could carry it, so this is a facts prep (S2a) after all.
        built = null;
        brief = renderConsultBrief(facts);
      }

      counts.prepped += 1;
      if (built) counts.fullBuilt += 1;
      newPreps += 1;
      counts.drafts += queued.filter((q) => q.id && !q.adopted).length;
      if (adoption) counts.adopted += 1;

      // The emails go BEFORE the marker is written: a crash between the two just posts the same keys with the same payload again
      // (Resend dedupes), where a marker with no email would never send the booked email.
      const bookedHeld = !!c.event && stageBookedRecently(records, lead.id, nowMs);
      const plan = planSends({ prepKey: c.key, startsAtMs: startMs, nowMs, preppedAtMs: nowMs, madeNow: true, suppressBooked: bookedHeld, bookedOnly: c.rerun, brief: adoption || built ? "full" : "facts", cutover: c.rerun ? null : reach, existing });
      await recordWithheld(ctx, counts, state, c, plan.withheld);
      await recordSuperseded(ctx, counts, state, c, plan.superseded);
      const content: PrepContent = adoption
        ? { adopted: itemText(adoption) }
        : built
          ? { adopted: brief.text, attach: { plan: built.attachPlan, files: built.files } }
          : { adopted: null };
      await deliver(ctx, deps, mailer, counts, state, g, c, plan.actions, content);
      if (built) await saveFiles(c, built.files);

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
            ...(q.adopted ? { adopted: true } : {}),
            // S2b: the full prep this assistant built (the BRIEFING only), with what became of its files: a later email reads it back.
            ...(built && q.kind === PREP_BRIEF_KIND && !q.adopted ? { full: true, attach: built.attachPlan } : {}),
          },
        })),
      );
      if (recordError) counts.unrecorded += 1;
    } catch (err) {
      if (err instanceof JudgmentBoundaryError) counts.refused += 1;
      else counts.failed += 1;
    }
  }

  return { itemsIn: counts.prepped, draftsOut: counts.drafts, summary: summaryOf(counts, stageUnread, calendar.outlookNotReady, mailboxModuleState(ctx)) };
}

/** The current stage of each live lead among these (a merged lead is absent). A failed read throws: the run fails rather than prep a lead it could not check. */
async function leadStages(admin: SupabaseClient, orgId: string, ids: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const batch of chunk([...ids], IN_CHUNK)) {
    const res = await leadRead(({ live }) => live(admin.from("crm_lead").select("id, current_stage_id")).eq("org_id", orgId).in("id", batch));
    if (res.error) throw new Error("The leads could not be read, so no consults were prepped.");
    for (const r of (res.data ?? []) as Array<{ id: string; current_stage_id: string | null }>) out.set(r.id, r.current_stage_id);
  }
  return out;
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
  if (c.adopted > 0) parts.push(`${plural(c.adopted, "consult", "consults")} reused a full prep that was already in Approvals, so no new briefing was queued.`);
  if (c.adoptionUnread > 0) parts.push(`${plural(c.adoptionUnread, "consult", "consults")} left for the next run: Approvals could not be read, so nothing was built or sent on a guess.`);
  if (c.withheld > 0) parts.push(`${plural(c.withheld, "email", "emails")} held back: only the facts brief exists, and an email carries the full prep. ${c.withheld === 1 ? "It is" : "They are"} sent if a full prep appears while still due.`);
  if (c.superseded > 0) parts.push(`${plural(c.superseded, "email", "emails")} not sent: the old brief was already scheduled for ${c.superseded === 1 ? "that consult" : "those consults"} before the switch-over.`);
  if (c.replyToRefused > 0) parts.push(`${plural(c.replyToRefused, "consult's emails", "consults' emails")} went without the reply-to address: it isn't a firm address for those emails.`);
  if (c.factsOnly > 0) parts.push(`${plural(c.factsOnly, "hour-before email", "hour-before emails")} sent or scheduled marked "facts only".`);
  if (c.upgraded > 0) parts.push(`${plural(c.upgraded, "facts-only email", "facts-only emails")} cancelled and planned again with the full prep.`);
  if (c.fullBuilt > 0) parts.push(`${plural(c.fullBuilt, "full prep", "full preps")} built.`);
  const failed = Object.entries(c.fullFailed).filter(([, n]) => (n ?? 0) > 0) as Array<[FullBuildFailure, number]>;
  if (failed.length > 0) {
    const n = failed.reduce((a, [, k]) => a + k, 0);
    parts.push(`${plural(n, "full prep", "full preps")} couldn't be built (${failed.map(([r, k]) => `${FULL_FAILURE_WORDS[r]}: ${k}`).join(", ")}); the facts brief stands and the next run tries again.`);
  }
  if (c.attachRefused > 0) parts.push(`${plural(c.attachRefused, "email", "emails")} sent again without attachments: the mail service refused them.`);
  if (c.filesSaved > 0) parts.push(`${plural(c.filesSaved, "file", "files")} saved to the lead's Documents & files.`);
  if (c.filesSkipped > 0) parts.push(`${plural(c.filesSkipped, "file", "files")} not saved: file storage isn't switched on for your firm yet.`);
  if (c.filesUnlogged > 0) parts.push(`${plural(c.filesUnlogged, "saved file", "saved files")} could not be noted on the lead's timeline.`);
  if (c.fullNoQueue > 0) parts.push(`${plural(c.fullNoQueue, "consult", "consults")} got the facts brief only: a full prep is kept in Approvals for every email, and no approval queue is connected.`);
  if (c.buildCapped > 0) parts.push(`${plural(c.buildCapped, "consult", "consults")} kept the facts brief: the full prep was already tried ${MAX_BUILD_ATTEMPTS} times.`);
  if (c.repaired > 0) parts.push(`${plural(c.repaired, "full prep", "full preps")} from an earlier run recorded on the lead now (nothing rebuilt).`);
  if (c.filesFailed > 0) parts.push(`${plural(c.filesFailed, "file", "files")} could not be saved to Documents & files.`);
  if (c.adoptedGone > 0) parts.push(`${plural(c.adoptedGone, "scheduled email", "scheduled emails")} cancelled because the prep they carried is no longer in Approvals.`);
  if (c.noTemplate > 0) parts.push(`${plural(c.noTemplate, "consult", "consults")} got only the heads-up: the client-prep email template isn't set up for this firm, so no client email was written.`);
  if (c.noAddress > 0) parts.push(`${plural(c.noAddress, "consult", "consults")} had no client address, so only the heads-up was written.`);
  if (c.refused > 0) parts.push(`${plural(c.refused, "consult", "consults")} held back because a draft contained attorney-judgment content.`);
  if (c.failed > 0) parts.push(`${plural(c.failed, "consult", "consults")} could not be prepped and will be tried again.`);
  if (c.partial > 0) parts.push(`${plural(c.partial, "consult", "consults")} got the heads-up but not the client email.`);
  if (c.unrecorded > 0) parts.push(`${plural(c.unrecorded, "prep", "preps")} could not be recorded on the lead, so they may be drafted again.`);
  const missing = Object.entries(c.unreadSections).filter(([, n]) => n > 0).map(([k]) => k);
  if (missing.length > 0) parts.push(`Some card sections could not be read: ${missing.join(", ")}.`);
  if (c.duplicate > 0) parts.push(`${plural(c.duplicate, "email", "emails")} had already been handled by another run.`);
  if (c.twins > 0) parts.push(`${plural(c.twins, "consult", "consults")} skipped: the same call is booked twice and is prepared once.`);
  if (c.alreadyPrepped > 0) parts.push(`${plural(c.alreadyPrepped, "consult", "consults")} had just been prepared by another run.`);
  if (c.leftCancelled > 0) parts.push(`${plural(c.leftCancelled, "reminder", "reminders")} cancelled because the lead left the pipeline.`);
  if (c.recipientsChanged > 0) parts.push(`${plural(c.recipientsChanged, "reminder", "reminders")} cancelled because who gets consult prep changed.`);
  if (c.leftSkipped > 0) parts.push(`${plural(c.leftSkipped, "consult", "consults")} skipped: the lead is in a lost or nurture stage.`);
  if (c.mergedSkipped > 0) parts.push(`${plural(c.mergedSkipped, "consult", "consults")} skipped: the lead was merged into another.`);
  if (stageUnread) parts.push("The consult stage could not be read, so leads were not checked by stage.");
  if (outlookNotReady) parts.push("The Outlook calendar isn't switched on for your firm yet.");
  // Outlook consults are read only with the Mailboxes feature; a feature list that could not be read is said, never "none".
  if (outlookGate === "unreadable") parts.push(`Outlook consults were not read: ${MAILBOX_GATE_REASON.unreadable}.`);
  if (c.over > 0) parts.push(`${plural(c.over, "consult", "consults")} left for the next run (limit ${PREP_BATCH}).`);
  if (c.leadsOver > 0) parts.push(`${plural(c.leadsOver, "more lead", "more leads")} entered the stage in the same request and ${c.leadsOver === 1 ? "is" : "are"} left for the next sweep.`);
  if (c.deferred > 0) parts.push(`${plural(c.deferred, "consult", "consults")} left for the next run: this run ran out of time.`);
  return parts.join(" ");
}

