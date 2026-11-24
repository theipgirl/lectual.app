import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAdminClient } from "@/lib/db/admin";
import { DB_FETCH_TIMEOUT_MS } from "@/lib/http/timeout";
import type { Database, Json } from "@/lib/db/types";
import { firmToken } from "@/lib/intake-forms/lawmatics-sync";
import { leadRead } from "@/lib/leads/live";
import { LAWMATICS_SYNC_KEY_REFUSED } from "@/lib/ui/words";
import { CAME_BACK_SOURCE } from "@/lib/today/came-back-rules";

import {
  LawmaticsApiError,
  createLawmaticsClient,
  lawmaticsFailureClass,
  type FetchLike,
  type LawmaticsClient,
  type LawmaticsFailureClass,
  type ListResult,
} from "./client";
import { consultWindow, planConsults, type ConsultLead, type ConsultMatter, type ConsultRowWrite, type OwnConsultRow } from "./consult-sync-plan";
import { normalizeLawmaticsEvent, type LawmaticsEvent } from "./events-normalize";
import { syncFirm, type FirmResult } from "./hired-sync";
import type { PlanStage, PlannedCreate } from "./import-plan";
import { field, idOf, includedIndex, records, type Raw } from "./jsonapi";
import { readOriginLookups, type OriginLookups } from "./lead-origin-read";
import { mergeContact, normalizeContact, normalizeProspect, type LawmaticsSourceContact } from "./normalize";
import {
  LEAD_CREATE_CAP,
  createdDates,
  nextLastSync,
  planProspectSync,
  syncCutoff,
  type LastSyncRead,
  type ProspectCandidate,
  type ProspectPlan,
  type SyncLead,
} from "./prospect-sync-plan";

/**
 * The Lawmatics daily sync (contract docs/pge/2026-11-17-agentic-ip-os/spec-lawmatics-daily-sync.md). Three steps per
 * firm: hired matters (the 4 AM run only, `syncFirm` with its rules unchanged), new prospects, then booked consults.
 *
 * SERVICE ROLE, per ACTIVE `lawmatics_connection` row, with THAT firm's own token (`firmToken`, lectual 0077). Every
 * read is filtered on the connection row's `org_id` and every write is stamped with it: never a value from Lawmatics
 * or from a request. READ-ONLY toward Lawmatics: only `listAll` and `get` are called (a grep test holds this file to
 * that). Nothing is sent, no automation rule runs, no matter handoff runs, no lead's stage is moved.
 *
 * Fail closed per step, per firm: a truncated, failed or unrecognised read writes nothing for that step. One firm
 * failing never stops another; the consult step still runs when the prospect step failed. A 401/403 marks the
 * connection `invalid` (fenced on its id, org and `active`) with a fixed sentence, and stops that firm.
 *
 * Counts only. No name, email, title, link or Lawmatics response text reaches a log, the result or `last_error`.
 */

type Admin = SupabaseClient<Database>;

/** `payload.source` on every timeline row this sync writes ("lead_created", the "came back" flag). */
export const DAILY_SYNC_SOURCE = CAME_BACK_SOURCE;
export const PROSPECT_INCLUDE = "stage,practice_area,contact";
/** The cron route's wall budget (its `maxDuration` is 300 s). */
export const WALL_BUDGET_MS = 270_000;
/** The "Sync from Lawmatics now" button's budget (the settings page exports `maxDuration = 300`). */
export const BUTTON_BUDGET_MS = 240_000;
export const FIRM_BUDGET_MS = 150_000;
export const HIRED_STEP_MS = 60_000;
export const PROSPECT_STEP_MS = 45_000;
export const CONSULT_STEP_MS = 45_000;
/** A firm is not started with less than this left of the wall budget. */
export const MIN_FIRM_START_MS = 60_000;
/** A step is not started when its slice would be shorter than this. */
export const MIN_STEP_MS = 10_000;
/** The consult step stops its targeted prospect reads with this much of its slice left, so its own writes always land. */
export const LOOKUP_MARGIN_MS = 15_000;
/** Read sizes: 100 records a page (Lawmatics' bracket pagination), and a deliberate ceiling per list. */
export const PAGE_SIZE = 100;
export const PROSPECTS_MAX_RECORDS = 6_000;
export const CONTACTS_MAX_RECORDS = 6_000;
/** /events: a firm can hold years of history. Past this the read is cut short: in-window consults are still written, removals held. */
export const EVENTS_MAX_RECORDS = 3_000;
const pagesFor = (max: number) => Math.ceil(max / PAGE_SIZE);
const PAGE = 1000;
const MAX_ROWS = 30_000;
const UPSERT_CHUNK = 100;
const DELETE_CHUNK = 50;

export type SyncMode = "full" | "daytime";

export type DailySyncSummary = {
  mode: SyncMode;
  connections: number;
  /** Firms where at least one step failed (or that had no usable token). */
  failedFirms: number;
  /** Firms whose key Lawmatics refused: set `invalid`, skipped until someone reconnects. */
  reauthNeeded: number;
  /** Steps or firms skipped, or steps cut short, for lack of time. */
  outOfTime: number;
  /** Failed Lawmatics calls by status class. Never their text. */
  failures: Record<LawmaticsFailureClass, number>;
  hired: { ran: number; failed: number; created: number; linked: number; skipped: number; failedWrites: number; leadsMoved: number; leadMovesFailed: number };
  prospects: {
    ran: number;
    failed: number;
    created: number;
    linked: number;
    cameBack: number;
    unchanged: number;
    needALook: number;
    leftForHired: number;
    beforeCutoff: number;
    /** Prospects with no readable created date: left out (counted). */
    noCreatedDate: number;
    overCap: number;
    failedWrites: number;
    flagsNotWritten: number;
    /** `lead_created` timeline rows that failed to write (the leads stand). */
    timelineNotWritten: number;
    /** Firms whose stage names Lawmatics didn't return (includes dropped): no leads written there. */
    stagesDropped: number;
    lastSyncSet: number;
    /** "Last successful run" can't be stored yet (lectual 0118 not applied): the cutoff stays 2026-11-01. */
    lastSyncNotReady: number;
    lastSyncWriteFailed: number;
  };
  consults: {
    ran: number;
    failed: number;
    written: number;
    removed: number;
    unchanged: number;
    unlinked: number;
    unusable: number;
    overCap: number;
    failedWrites: number;
    heldByOlderRow: number;
    prospectReadsFailed: number;
    /** The calendar columns aren't there yet (lectual 0098). */
    notReady: number;
    /** Runs whose VANISHED rows were held: an incomplete read (a record with no id, cut short, types dropped), an empty read,
     * or more than half the stored rows gone. Rows read as cancelled, not a consult or out of the window are still removed. */
    removalsHeld: number;
    /** /events reads cut short at the cap: in-window consults were still written. */
    eventsTruncated: number;
    /** Consult prospects not looked up because a matter already holds that Lawmatics id (hired). */
    hiredSkipped: number;
    /** Consult prospects not looked up this run because the step kept its margin for its own writes. */
    lookupsDeferred: number;
  };
  /** Firms whose Lawmatics key couldn't be opened: nothing synced for them. */
  tokenUnreadable: number;
  /**
   * The consult prep run after a firm's consult step (counts only). `ran`: it ran (its own summary is in the Assistants log);
   * `notOn`: the firm hasn't switched the assistant on (or Autopilot is paused); `skippedForTime`: too little of the wall budget was
   * left, so it was left to the next sweep; `failed`: it could not start or threw. Never changes the sync's other counts.
   */
  consultPrep: { ran: number; notOn: number; skippedForTime: number; failed: number };
};

export type StepClientOptions = { signal: AbortSignal; timeLeftMs: () => number };

export type DailySyncDeps = {
  admin?: Admin;
  /** Restrict to one firm (the button). The org comes from the session, never from a form. */
  orgId?: string;
  mode?: SyncMode;
  getToken?: (admin: Admin, orgId: string) => Promise<string | null>;
  fetchImpl?: FetchLike;
  client?: (token: string, opts: StepClientOptions) => LawmaticsClient;
  now?: () => Date;
  /** Monotonic-ish milliseconds for the budget. Defaults to Date.now. */
  clock?: () => number;
  budgetMs?: number;
  /**
   * Runs after a firm's consult step finished (not failed): the consult prep sweep for that firm. It is wrapped, so a throw
   * is counted and never changes the sync's result. Absent = no prep (tests, the button).
   */
  afterConsults?: (orgId: string, info: { timeLeftMs: number }) => Promise<"ran" | "not-on">;
};

/** The consult prep sweep is not started with less than this left of the wall budget (counted, left to the next sweep). */
export const MIN_PREP_START_MS = 30_000;

export function emptySummary(mode: SyncMode): DailySyncSummary {
  return {
    mode,
    connections: 0,
    failedFirms: 0,
    reauthNeeded: 0,
    outOfTime: 0,
    failures: { auth: 0, forbidden: 0, rate: 0, server: 0, timeout: 0, shape: 0 },
    hired: { ran: 0, failed: 0, created: 0, linked: 0, skipped: 0, failedWrites: 0, leadsMoved: 0, leadMovesFailed: 0 },
    prospects: {
      ran: 0,
      failed: 0,
      created: 0,
      linked: 0,
      cameBack: 0,
      unchanged: 0,
      needALook: 0,
      leftForHired: 0,
      beforeCutoff: 0,
      noCreatedDate: 0,
      overCap: 0,
      failedWrites: 0,
      flagsNotWritten: 0,
      timelineNotWritten: 0,
      stagesDropped: 0,
      lastSyncSet: 0,
      lastSyncNotReady: 0,
      lastSyncWriteFailed: 0,
    },
    consults: { ran: 0, failed: 0, written: 0, removed: 0, unchanged: 0, unlinked: 0, unusable: 0, overCap: 0, failedWrites: 0, heldByOlderRow: 0, prospectReadsFailed: 0, notReady: 0, removalsHeld: 0, eventsTruncated: 0, hiredSkipped: 0, lookupsDeferred: 0 },
    tokenUnreadable: 0,
    consultPrep: { ran: 0, notOn: 0, skippedForTime: 0, failed: 0 },
  };
}

/** A read that failed in a way the step counts. `cls` is set when Lawmatics itself refused or didn't answer. */
class StepFailure extends Error {
  constructor(readonly cls: LawmaticsFailureClass | null) {
    super("step failed");
    this.name = "StepFailure";
  }
}

const isColumnMissing = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "42703" || code === "PGRST204";
};

async function pageAll<T>(read: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<{ rows: T[] } | { error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await read(from, from + PAGE - 1);
    if (error || !data) return { error: error ?? new Error("no data") };
    rows.push(...data);
    if (data.length < PAGE) return { rows };
  }
  return { error: new Error("too many rows") }; // not a complete read
}

// ── reads ────────────────────────────────────────────────────────────────────

/** What the hired step read before this sync existed: `/prospects` and the origin names. Shared with the prospect step. */
type SharedRead = { prospects: ListResult; lookups: OriginLookups };

/** One `/prospects` request (the importer's include plus the hired sync's `fields=all`) and the origin names. */
async function readShared(client: LawmaticsClient): Promise<SharedRead> {
  const prospects = await client.listAll("/prospects", { include: PROSPECT_INCLUDE, params: { fields: "all" }, pageSize: PAGE_SIZE, maxRecords: PROSPECTS_MAX_RECORDS, maxPages: pagesFor(PROSPECTS_MAX_RECORDS) });
  const lookups = await readOriginLookups(client);
  return { prospects, lookups };
}

/** `/contacts`, read by the prospect step only. Null when it failed or was cut short (no leads are then written). */
async function readContacts(client: LawmaticsClient): Promise<Map<string, LawmaticsSourceContact> | null> {
  let contacts: Map<string, LawmaticsSourceContact> | null = null;
  try {
    const c = await client.listAll("/contacts", { pageSize: PAGE_SIZE, maxRecords: CONTACTS_MAX_RECORDS, maxPages: pagesFor(CONTACTS_MAX_RECORDS) });
    if (!c.truncated && !c.unrecognisedShape) {
      contacts = new Map(
        c.records
          .map((rec) => normalizeContact(rec))
          .filter((x): x is LawmaticsSourceContact => x !== null)
          .map((x) => [x.lawmaticsId, x]),
      );
    }
  } catch (err) {
    // An auth refusal is the firm's key: it stops the firm whichever read saw it.
    if (lawmaticsFailureClass(err) === "auth") throw err;
    contacts = null;
  }
  return contacts;
}

export function candidateOf(raw: Raw, included: Map<string, Raw>, lookups: OriginLookups, contacts: Map<string, LawmaticsSourceContact> | null): ProspectCandidate | null {
  const rec = normalizeProspect(raw, included, lookups);
  if (!rec) return null;
  const merged = rec.contactId && contacts ? mergeContact(rec, contacts.get(rec.contactId)) : rec;
  return { record: merged, status: field(raw, "status"), convertedDate: field(raw, "converted_date", "converted_at") };
}

const LEAD_COLUMNS = "id,email,first_name,last_name,phone,business_name,website,current_stage_id,lawmatics_id,practice_area,referral_source,referral_detail";

async function readLeads(admin: Admin, orgId: string): Promise<SyncLead[]> {
  const r = await pageAll<SyncLead>((a, b) =>
    leadRead(({ merged }) =>
      admin
        // live-guard: reads merged leads WITH their pointer; the planners follow them to the keeper and never write them
        .from("crm_lead")
        .select(merged ? `${LEAD_COLUMNS},merged_into_id` : LEAD_COLUMNS)
        .eq("org_id", orgId)
        .order("created_at", { ascending: true })
        .range(a, b),
    ) as unknown as PromiseLike<{ data: SyncLead[] | null; error: unknown }>,
  );
  if ("error" in r) throw new StepFailure(null);
  return r.rows;
}

async function readStages(admin: Admin, orgId: string): Promise<PlanStage[]> {
  const { data, error } = await admin.from("crm_stage").select("id,name,category,order_index").eq("org_id", orgId).order("order_index", { ascending: true });
  if (error || !data) throw new StepFailure(null);
  return data.map((s) => ({ id: s.id, name: s.name, category: s.category === null || s.category === undefined ? undefined : String(s.category), orderIndex: s.order_index ?? undefined }));
}

/** "Last complete run" for this connection: ok, not set up (before lectual 0118), or couldn't be read. */
export async function readLastSync(admin: Admin, connId: string, orgId: string): Promise<LastSyncRead> {
  try {
    const { data, error } = await admin
      .from("lawmatics_connection")
      .select("last_sync_at")
      .eq("id", connId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (error) return isColumnMissing(error) ? { status: "not-set-up" } : { status: "unavailable" };
    return { status: "ok", value: typeof data?.last_sync_at === "string" ? data.last_sync_at : null };
  } catch {
    return { status: "unavailable" };
  }
}

// ── writes (all stamped with the connection row's org_id) ─────────────────────

type ProspectWriteCounts = {
  created: number;
  linked: number;
  cameBack: number;
  failedWrites: number;
  flagsNotWritten: number;
  /** `lead_created` timeline rows that failed (the lead stands; counted, never undone). */
  timelineNotWritten: number;
  /** Lead ids created, so a later plan in the same run sees them. */
  createdLeads: Array<{ id: string; create: PlannedCreate }>;
  stoppedForTime: boolean;
};

async function applyProspectPlan(admin: Admin, orgId: string, plan: ProspectPlan, runIso: string, nowMs: number, inTime: () => boolean): Promise<ProspectWriteCounts> {
  const out: ProspectWriteCounts = { created: 0, linked: 0, cameBack: 0, failedWrites: 0, flagsNotWritten: 0, timelineNotWritten: 0, createdLeads: [], stoppedForTime: false };
  for (const c of plan.creates) {
    if (!inTime()) return { ...out, stoppedForTime: true };
    const r = await insertLead(admin, orgId, c, runIso, nowMs);
    if (r.status === "failed") {
      out.failedWrites += 1;
      continue;
    }
    out.created += 1;
    out.createdLeads.push({ id: r.id, create: c });
    if (!r.timeline) out.timelineNotWritten += 1;
  }
  for (const l of plan.links) {
    if (!inTime()) return { ...out, stoppedForTime: true };
    const r = await linkLead(admin, orgId, l.leadId, l.lawmaticsId);
    if (r === "linked") out.linked += 1;
    else if (r === "failed") out.failedWrites += 1;
  }
  for (const cb of plan.cameBack) {
    if (!inTime()) return { ...out, stoppedForTime: true };
    // Flag once per lead and Lawmatics id. An unreadable check writes nothing (a duplicate would never go away).
    const exists = await cameBackExists(admin, orgId, cb.leadId, cb.lawmaticsId);
    if (exists === "failed") {
      out.flagsNotWritten += 1;
      continue;
    }
    if (exists) continue;
    if (cb.writeId) {
      // The flag goes in only once the link landed (or someone linked the lead meanwhile): a failed link is retried
      // next run, and a flag already written would otherwise stop that retry.
      const r = await linkLead(admin, orgId, cb.leadId, cb.lawmaticsId);
      if (r === "failed") {
        out.failedWrites += 1;
        continue;
      }
    }
    const { error } = await admin.from("crm_activity").insert({
      org_id: orgId,
      lead_id: cb.leadId,
      type: "ai_insight",
      actor_type: "system",
      actor_id: null,
      payload: { source: DAILY_SYNC_SOURCE, kind: "came_back", lawmatics_id: cb.lawmaticsId, stage_category: cb.category } as Json,
    });
    if (error) out.flagsNotWritten += 1;
    else out.cameBack += 1;
  }
  return out;
}

async function insertLead(admin: Admin, orgId: string, c: PlannedCreate, runIso: string, nowMs: number): Promise<{ status: "failed" } | { status: "created"; id: string; timeline: boolean }> {
  try {
    const { data, error } = await admin
      .from("crm_lead")
      .insert({
        org_id: orgId,
        first_name: c.fields.first_name,
        last_name: c.fields.last_name,
        email: c.fields.email,
        phone: c.fields.phone,
        business_name: c.fields.business_name,
        website: c.fields.website,
        practice_area: c.fields.practice_area,
        referral_source: c.fields.referral_source,
        referral_detail: c.fields.referral_detail,
        current_stage_id: c.stageId,
        lawmatics_id: c.lawmaticsId,
        // Stage age: entered now; created / last touched when Lawmatics created it. `lawmatics_synced_at` stays null,
        // so the card reads "0d in stage", not "In stage since import".
        stage_entered_at: runIso,
        ...createdDates(c.createdAt, nowMs),
      })
      .select("id")
      .single();
    if (error || !data) return { status: "failed" }; // a 23505 (crm_lead_org_lawmatics_id_uniq) is counted; the rest go on
    // A failed timeline row never undoes the lead; it is counted. Never carries lawmatics_stage_unmapped / hired_in_lawmatics.
    const { error: actError } = await admin.from("crm_activity").insert({
      org_id: orgId,
      lead_id: data.id,
      // lectual 0033's activity type; the generated union predates it (same cast as the public intake's).
      type: "lead_created" as Database["public"]["Tables"]["crm_activity"]["Insert"]["type"],
      actor_type: "system",
      actor_id: null,
      payload: { source: DAILY_SYNC_SOURCE, lawmatics_id: c.lawmaticsId } as Json,
    });
    return { status: "created", id: data.id, timeline: !actError };
  } catch {
    return { status: "failed" };
  }
}

/** Writes `lawmatics_id` ONLY, on a live lead that has none. Nothing else of the lead changes. */
async function linkLead(admin: Admin, orgId: string, leadId: string, lawmaticsId: string): Promise<"linked" | "stale" | "failed"> {
  try {
    const { data, error } = await leadRead(({ live }) =>
      live(admin.from("crm_lead").update({ lawmatics_id: lawmaticsId }))
        .eq("id", leadId)
        .eq("org_id", orgId)
        .is("lawmatics_id", null)
        .select("id"),
    );
    if (error) return "failed";
    return data && data.length > 0 ? "linked" : "stale";
  } catch {
    return "failed";
  }
}

async function cameBackExists(admin: Admin, orgId: string, leadId: string, lawmaticsId: string): Promise<boolean | "failed"> {
  try {
    const { data, error } = await admin
      .from("crm_activity")
      .select("id")
      .eq("org_id", orgId)
      .eq("lead_id", leadId)
      .eq("type", "ai_insight")
      .eq("payload->>source", DAILY_SYNC_SOURCE)
      .eq("payload->>kind", "came_back")
      .eq("payload->>lawmatics_id", lawmaticsId)
      .limit(1);
    if (error) return "failed";
    return (data ?? []).length > 0;
  } catch {
    return "failed";
  }
}

async function writeLastSync(admin: Admin, connId: string, orgId: string, value: string): Promise<"set" | "not-ready" | "failed"> {
  try {
    const { error } = await admin
      .from("lawmatics_connection")
      .update({ last_sync_at: value })
      .eq("id", connId)
      .eq("org_id", orgId);
    if (!error) return "set";
    return isColumnMissing(error) ? "not-ready" : "failed";
  } catch {
    return "failed";
  }
}

/** A refused key: `invalid` (0077's value), fenced on the row's id, org and `active`, with a fixed sentence only. */
async function markInvalid(admin: Admin, connId: string, orgId: string): Promise<void> {
  try {
    await admin
      .from("lawmatics_connection")
      .update({ status: "invalid", last_error: LAWMATICS_SYNC_KEY_REFUSED, updated_at: new Date().toISOString() })
      .eq("id", connId)
      .eq("org_id", orgId)
      .eq("status", "active");
  } catch {
    /* counted as reauthNeeded either way */
  }
}

// ── the steps ────────────────────────────────────────────────────────────────

type StepCtx = { client: LawmaticsClient; inTime: () => boolean; timeLeftMs: () => number };

function failureOf(err: unknown): LawmaticsFailureClass | null {
  if (err instanceof StepFailure) return err.cls;
  return lawmaticsFailureClass(err);
}

async function prospectStep(
  admin: Admin,
  conn: { id: string; org_id: string },
  ctx: StepCtx,
  shared: SharedRead,
  run: { iso: string; nowMs: number },
  budget: { createsUsed: number; linksUsed: number },
  s: DailySyncSummary,
): Promise<void> {
  const orgId = conn.org_id;
  const p = shared.prospects;
  if (p.truncated || p.unrecognisedShape) throw new StepFailure("shape");
  if (p.includeDropped) {
    // Stage names are unknown, so a hired stage name can't be recognised: no leads for this firm this run.
    s.prospects.stagesDropped += 1;
    throw new StepFailure(null);
  }
  const contacts = await readContacts(ctx.client);
  if (!contacts) throw new StepFailure(null); // /contacts cut short or failed: stricter than the manual importer

  const prospects = p.records.map((raw) => candidateOf(raw, p.included, shared.lookups, contacts)).filter((x): x is ProspectCandidate => x !== null);
  const [stages, leads, last] = await Promise.all([readStages(admin, orgId), readLeads(admin, orgId), readLastSync(admin, conn.id, orgId)]);
  if (last.status === "not-set-up") s.prospects.lastSyncNotReady += 1;
  const plan = planProspectSync({ prospects, stages, leads, cutoff: syncCutoff(last) });
  if (!ctx.inTime()) {
    s.outOfTime += 1;
    return; // out of time before writing: nothing written, "last run" unchanged
  }
  // The per-run caps are shared with the consult step's targeted reads.
  budget.createsUsed += plan.creates.length;
  budget.linksUsed += plan.links.length + plan.cameBack.filter((c) => c.writeId).length;
  const w = await applyProspectPlan(admin, orgId, plan, run.iso, run.nowMs, ctx.inTime);
  s.prospects.created += w.created;
  s.prospects.linked += w.linked;
  s.prospects.cameBack += w.cameBack;
  s.prospects.failedWrites += w.failedWrites;
  s.prospects.flagsNotWritten += w.flagsNotWritten;
  s.prospects.timelineNotWritten += w.timelineNotWritten;
  s.prospects.unchanged += plan.counts.unchanged;
  s.prospects.needALook += plan.counts.needALook;
  s.prospects.leftForHired += plan.counts.leftForHired;
  s.prospects.beforeCutoff += plan.counts.beforeCutoff;
  s.prospects.noCreatedDate += plan.counts.noCreatedDate;
  s.prospects.overCap += plan.counts.overCap;
  if (w.stoppedForTime) s.outOfTime += 1;

  const next = nextLastSync({ complete: w.failedWrites === 0 && w.flagsNotWritten === 0, inTime: !w.stoppedForTime && ctx.inTime(), overCap: plan.counts.overCap, runStartedAt: run.iso });
  if (next && last.status !== "not-set-up") {
    const r = await writeLastSync(admin, conn.id, orgId, next);
    if (r === "set") s.prospects.lastSyncSet += 1;
    else if (r === "not-ready") s.prospects.lastSyncNotReady += 1;
    else s.prospects.lastSyncWriteFailed += 1;
  }
}

async function readOwnRows(admin: Admin, orgId: string): Promise<OwnConsultRow[] | "not-ready"> {
  const r = await pageAll<OwnConsultRow>((a, b) =>
    admin
      .from("crm_calendar_event")
      .select("id,external_id,title,starts_at,ends_at,all_day,event_type,lead_id,matter_id,join_url,is_consult")
      .eq("org_id", orgId)
      .eq("source", "lawmatics")
      .like("external_id", "lmsync:%")
      .order("starts_at", { ascending: true })
      .range(a, b) as unknown as PromiseLike<{ data: OwnConsultRow[] | null; error: unknown }>,
  );
  if ("error" in r) {
    if (isColumnMissing(r.error)) return "not-ready";
    throw new StepFailure(null);
  }
  return r.rows;
}

async function readMatters(admin: Admin, orgId: string): Promise<ConsultMatter[]> {
  const r = await pageAll<ConsultMatter>((a, b) =>
    admin.from("crm_matter").select("id,lawmatics_id").eq("org_id", orgId).not("lawmatics_id", "is", null).order("created_at", { ascending: true }).range(a, b),
  );
  if ("error" in r) throw new StepFailure(null);
  return r.rows;
}

/** One prospect by id, for a consult whose prospect no lead holds. The answer must name the id asked for. */
export async function readOneProspect(client: LawmaticsClient, id: string, lookups: OriginLookups): Promise<ProspectCandidate | null> {
  // `fields=all` as on the list, so `status` and `converted_date` are there and a hired prospect is never filed as a new enquiry.
  const payload = await client.get(`/prospects/${encodeURIComponent(id)}`, { include: PROSPECT_INCLUDE, fields: "all" });
  const rec = records(payload)[0];
  if (!rec || idOf(rec) !== id) return null; // anything else is discarded
  // Without `status` the hired rule can't be applied: unusable, never guessed.
  if (field(rec, "status") === null) return null;
  const candidate = candidateOf(rec, includedIndex(payload), lookups, null);
  if (!candidate) return null;
  if (!candidate.record.email && candidate.record.contactId) {
    const contactPayload = await client.get(`/contacts/${encodeURIComponent(candidate.record.contactId)}`);
    const contactRec = records(contactPayload)[0];
    const contact = contactRec && idOf(contactRec) === candidate.record.contactId ? normalizeContact(contactRec) : null;
    if (contact) candidate.record = mergeContact(candidate.record, contact);
  }
  return candidate;
}

/**
 * `/events`, 100 a page, capped. The window is SENT as a filter, but it is a hint only (NOT verified that Lawmatics
 * honours it, and it ignores unknown parameters silently): the planner applies the window again. A 400/422 for the
 * filter is retried once without it, so an unknown parameter can never fail every run.
 */
async function readEvents(client: LawmaticsClient, nowMs: number): Promise<ListResult> {
  const { from, to } = consultWindow(nowMs);
  const base = { include: "event_type", pageSize: PAGE_SIZE, maxRecords: EVENTS_MAX_RECORDS, maxPages: pagesFor(EVENTS_MAX_RECORDS) };
  try {
    return await client.listAll("/events", {
      ...base,
      params: { "filter[start_time][gte]": new Date(from).toISOString(), "filter[start_time][lte]": new Date(to).toISOString() },
    });
  } catch (err) {
    if (err instanceof LawmaticsApiError && (err.status === 400 || err.status === 422)) return client.listAll("/events", base);
    throw err;
  }
}

async function consultStep(
  admin: Admin,
  conn: { id: string; org_id: string },
  ctx: StepCtx,
  lookups: OriginLookups | null,
  run: { iso: string; nowMs: number },
  budget: { createsUsed: number; linksUsed: number },
  s: DailySyncSummary,
): Promise<void> {
  const orgId = conn.org_id;
  const list = await readEvents(ctx.client, run.nowMs);
  // A cut-short read (more history than the cap) still writes the in-window consults it has; only removals wait.
  if (list.unrecognisedShape) throw new StepFailure("shape");
  if (list.truncated) s.consults.eventsTruncated += 1;
  const events: LawmaticsEvent[] = [];
  let unusable = 0;
  let unusableNoId = 0;
  const heldIds: string[] = [];
  for (const raw of list.records) {
    const n = normalizeLawmaticsEvent(raw, list.included);
    if (n.ok) {
      events.push(n.event);
      continue;
    }
    unusable += 1;
    // A record we couldn't read holds its own row; one with no id at all could be any stored consult.
    if (n.reason === "no-id") unusableNoId += 1;
    else if (n.id) heldIds.push(n.id);
  }
  s.consults.unusable += unusable;
  const own = await readOwnRows(admin, orgId);
  if (own === "not-ready") {
    s.consults.notReady += 1;
    return; // before lectual 0098: nothing written or removed
  }
  const [stages, matters] = await Promise.all([readStages(admin, orgId), readMatters(admin, orgId)]);
  let leads = await readLeads(admin, orgId);
  // Vanished rows are removed only after a COMPLETE read: nothing cut short, the event types kept, every record with an id.
  const complete = !list.truncated && !list.includeDropped && unusableNoId === 0;
  const planOf = () =>
    planConsults({ events, leads: leads as ConsultLead[], matters, ownRows: own, nowMs: run.nowMs, complete: complete && ctx.inTime(), heldIds, recordsRead: list.records.length });
  let plan = planOf();
  // Prospects a matter already holds (hired) are the hired sync's: never looked up here, every run.
  const hiredIds = new Set(matters.map((m) => m.lawmatics_id).filter((x): x is string => !!x));
  const toLookUp = plan.needProspects.filter((id) => !hiredIds.has(id));
  s.consults.hiredSkipped += plan.needProspects.length - toLookUp.length;

  // A consult whose prospect is not a lead yet: one targeted read each, then ALL of them planned together through the
  // prospect step's own rules (one plan, so two prospects with one email make one lead). No read once the create cap is used.
  // The lookups stop with LOOKUP_MARGIN_MS of the slice left, so the plan below is always written.
  if (toLookUp.length > 0) {
    const candidates: ProspectCandidate[] = [];
    for (const [i, id] of toLookUp.entries()) {
      if (!ctx.inTime() || ctx.timeLeftMs() < LOOKUP_MARGIN_MS) {
        s.consults.lookupsDeferred += toLookUp.length - i; // they wait for the next run
        break;
      }
      if (budget.createsUsed >= LEAD_CREATE_CAP) {
        s.prospects.overCap += toLookUp.length - i; // they wait for the next run
        break;
      }
      let candidate: ProspectCandidate | null = null;
      try {
        candidate = await readOneProspect(ctx.client, id, lookups ?? { tagNames: new Map(), fieldNames: new Map() });
      } catch (err) {
        if (lawmaticsFailureClass(err) === "auth") throw err;
        candidate = null;
      }
      if (!candidate) s.consults.prospectReadsFailed += 1;
      else candidates.push(candidate);
    }
    if (candidates.length > 0 && ctx.inTime() && ctx.timeLeftMs() >= LOOKUP_MARGIN_MS) {
      const p = planProspectSync({ prospects: candidates, stages, leads, cutoff: run.iso, ignoreCutoff: true, createsUsed: budget.createsUsed, linksUsed: budget.linksUsed });
      budget.createsUsed += p.creates.length;
      budget.linksUsed += p.links.length + p.cameBack.filter((c) => c.writeId).length;
      const w = await applyProspectPlan(admin, orgId, p, run.iso, run.nowMs, ctx.inTime);
      s.prospects.created += w.created;
      s.prospects.linked += w.linked;
      s.prospects.cameBack += w.cameBack;
      s.prospects.failedWrites += w.failedWrites;
      s.prospects.flagsNotWritten += w.flagsNotWritten;
      s.prospects.timelineNotWritten += w.timelineNotWritten;
      s.prospects.overCap += p.counts.overCap;
      s.prospects.needALook += p.counts.needALook;
      s.prospects.leftForHired += p.counts.leftForHired;
      if (w.created + w.linked + w.cameBack > 0) {
        leads = await readLeads(admin, orgId);
        plan = planOf();
      }
    }
  }

  if (!ctx.inTime()) {
    s.outOfTime += 1;
    return; // a step that runs out of time writes nothing (no upserts, no removals)
  }
  if (plan.removalHold) s.consults.removalsHeld += 1;
  s.consults.unchanged += plan.counts.unchanged;
  s.consults.unlinked += plan.counts.unlinked;
  s.consults.overCap += plan.counts.overWriteCap + plan.counts.overRemoveCap;

  const stamp = new Date(run.nowMs).toISOString();
  const rows = plan.writes.map((r: ConsultRowWrite) => ({ ...r, org_id: orgId, synced_at: stamp }));
  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await admin.from("crm_calendar_event").upsert(chunk, { onConflict: "org_id,source,external_id" });
    if (!error) {
      s.consults.written += chunk.length;
      continue;
    }
    // One refused row fails the statement: retry one by one so the rest still land.
    for (const row of chunk) {
      const { error: rowError } = await admin.from("crm_calendar_event").upsert(row, { onConflict: "org_id,source,external_id" });
      if (!rowError) s.consults.written += 1;
      else if ((rowError as { code?: string }).code === "23505") s.consults.heldByOlderRow += 1; // an older Lawmatics row holds the id: left alone
      else s.consults.failedWrites += 1;
    }
  }
  for (let i = 0; i < plan.removeIds.length; i += DELETE_CHUNK) {
    const ids = plan.removeIds.slice(i, i + DELETE_CHUNK);
    const { data, error } = await admin
      .from("crm_calendar_event")
      .delete()
      .eq("org_id", orgId)
      .eq("source", "lawmatics")
      .like("external_id", "lmsync:%")
      .in("id", ids)
      .select("id");
    if (error) s.consults.failedWrites += ids.length;
    else s.consults.removed += (data ?? []).length;
  }
}

// ── the run ──────────────────────────────────────────────────────────────────

type FirmState = {
  conn: { id: string; org_id: string };
  token: string | null;
  refused: boolean;
  failed: boolean;
  /** undefined: not read yet; null: the read failed. */
  shared: SharedRead | null | undefined;
  budget: { createsUsed: number; linksUsed: number };
};

/** The order the prospect and consult steps visit firms: rotated by the hour, so a slow firm can't starve the same one every run. */
export function fairOrder<T>(items: readonly T[], nowMs: number): T[] {
  if (items.length === 0) return [];
  const start = Math.floor(nowMs / 3_600_000) % items.length;
  return [...items.slice(start), ...items.slice(0, start)];
}

/**
 * Two passes. (1) The full run's hired step for EVERY firm first (each inside its own 60 s slice), so no firm's matters
 * wait on another firm's slow Lawmatics. (2) New prospects then consults, firm by firm in `fairOrder`, each firm at most
 * 150 s, none started with under 60 s of the wall budget left.
 */
export async function runLawmaticsDailySync(deps: DailySyncDeps = {}): Promise<DailySyncSummary> {
  const mode: SyncMode = deps.mode ?? "full";
  // A deadline on every database statement too, so the wall budget's headroom holds (as the agents' client does).
  const admin = deps.admin ?? getAdminClient({ timeoutMs: DB_FETCH_TIMEOUT_MS });
  const getToken = deps.getToken ?? ((a, o) => firmToken(a, o));
  const makeClient =
    deps.client ?? ((token: string, o: StepClientOptions) => createLawmaticsClient({ token, fetchImpl: deps.fetchImpl, signal: o.signal, timeLeftMs: o.timeLeftMs }));
  const clock = deps.clock ?? (() => Date.now());
  const now = deps.now ?? (() => new Date());
  const wallDeadline = clock() + (deps.budgetMs ?? WALL_BUDGET_MS);
  const s = emptySummary(mode);
  const runDate = now();
  const run = { iso: runDate.toISOString(), nowMs: runDate.getTime() };

  // Active connections only: an `invalid` firm is skipped until someone reconnects.
  let q = admin.from("lawmatics_connection").select("id, org_id").eq("status", "active");
  if (deps.orgId) q = q.eq("org_id", deps.orgId);
  const { data: conns, error } = await q;
  if (error) throw new Error("connection read failed");
  s.connections = conns?.length ?? 0;

  const firms: FirmState[] = (conns ?? []).map((conn) => ({ conn, token: null, refused: false, failed: false, shared: undefined, budget: { createsUsed: 0, linksUsed: 0 } }));

  const note = (f: FirmState, cls: LawmaticsFailureClass | null) => {
    if (cls) s.failures[cls] += 1;
    if (cls === "auth") f.refused = true;
  };

  /** The firm's token, read once. False when it couldn't be opened (counted; nothing runs for that firm). */
  const ensureToken = async (f: FirmState): Promise<boolean> => {
    if (f.token) return true;
    if (f.failed && !f.token) return false;
    try {
      f.token = await getToken(admin, f.conn.org_id);
    } catch {
      f.token = null;
    }
    if (!f.token) {
      f.failed = true;
      s.tokenUnreadable += 1;
      return false;
    }
    return true;
  };

  /**
   * Runs one step inside its slice (capped by `limitAt`). "time" (skipped for lack of time, or cut off by its deadline) is
   * counted in `outOfTime`, never as a failed step.
   */
  const step = async (f: FirmState, maxMs: number, limitAt: number, body: (ctx: StepCtx) => Promise<void>): Promise<"ok" | "failed" | "time"> => {
    if (f.refused || !f.token) return "failed";
    const start = clock();
    const slice = Math.min(maxMs, limitAt - start);
    if (slice < MIN_STEP_MS) {
      s.outOfTime += 1;
      return "time";
    }
    const deadline = start + slice;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(new DOMException("step out of time", "TimeoutError")), slice);
    const inTime = () => !ac.signal.aborted && clock() < deadline;
    const client = makeClient(f.token, { signal: ac.signal, timeLeftMs: () => deadline - clock() });
    try {
      await body({ client, inTime, timeLeftMs: () => deadline - clock() });
      return "ok";
    } catch (err) {
      const cls = failureOf(err);
      note(f, cls);
      if (cls === "timeout") {
        s.outOfTime += 1;
        return "time";
      }
      return "failed";
    } finally {
      clearTimeout(timer);
    }
  };

  const ensureShared = async (f: FirmState, ctx: StepCtx): Promise<SharedRead | null> => {
    if (f.shared !== undefined) return f.shared;
    try {
      f.shared = await readShared(ctx.client);
    } catch (err) {
      f.shared = null;
      throw err;
    }
    return f.shared;
  };

  // ── pass 1: hired matters for every firm (the 4 AM run and the button only). Its rules are unchanged. ──
  if (mode === "full") {
    for (const f of firms) {
      if (!(await ensureToken(f))) continue;
      s.hired.ran += 1;
      let result: FirmResult | null = null;
      const outcome = await step(f, HIRED_STEP_MS, wallDeadline, async (ctx) => {
        const sh = await ensureShared(f, ctx);
        result = await syncFirm(admin, f.conn.org_id, ctx.client, now(), sh);
      });
      const r = result as FirmResult | null;
      if (r) {
        if (r.failure) note(f, r.failure);
        s.hired.created += r.created;
        s.hired.linked += r.linked;
        s.hired.skipped += r.skipped;
        s.hired.failedWrites += r.failedWrites;
        s.hired.leadsMoved += r.leadsMoved;
        s.hired.leadMovesFailed += r.leadMovesFailed;
      }
      // A time-out (the step's, or a Lawmatics request's inside syncFirm) is counted as out of time, not as a failure.
      const timedOut = outcome === "time" || (outcome === "ok" && r?.failure === "timeout");
      if (timedOut) {
        if (outcome === "ok") s.outOfTime += 1;
      } else if (outcome !== "ok" || !r || !r.ok) {
        s.hired.failed += 1;
        f.failed = true;
      }
    }
  }

  // ── pass 2: new prospects, then consults, firm by firm in a rotating order ──
  for (const f of fairOrder(firms, run.nowMs)) {
    if (f.refused) continue;
    if (!(await ensureToken(f))) continue;
    const firmStart = clock();
    if (wallDeadline - firmStart < MIN_FIRM_START_MS) {
      s.outOfTime += 1;
      continue;
    }
    const firmDeadline = Math.min(firmStart + FIRM_BUDGET_MS, wallDeadline);

    s.prospects.ran += 1;
    const okP = await step(f, PROSPECT_STEP_MS, firmDeadline, async (ctx) => {
      const sh = await ensureShared(f, ctx);
      if (!sh) throw new StepFailure(null);
      await prospectStep(admin, f.conn, ctx, sh, run, f.budget, s);
    });
    if (okP === "failed") {
      s.prospects.failed += 1;
      f.failed = true;
    }

    // Consults still run when the prospect step failed (they link to the leads that exist).
    if (!f.refused) {
      s.consults.ran += 1;
      const okC = await step(f, CONSULT_STEP_MS, firmDeadline, async (ctx) => {
        await consultStep(admin, f.conn, ctx, f.shared ? f.shared.lookups : null, run, f.budget, s);
      });
      if (okC === "failed") {
        s.consults.failed += 1;
        f.failed = true;
      }
      if (okC !== "failed" && deps.afterConsults) {
        // The consult prep sweep for this firm, with whatever the wall budget has left. It can never change the sync's result.
        const left = wallDeadline - clock();
        if (left < MIN_PREP_START_MS) s.consultPrep.skippedForTime += 1;
        else {
          try {
            const r = await deps.afterConsults(f.conn.org_id, { timeLeftMs: left });
            if (r === "ran") s.consultPrep.ran += 1;
            else s.consultPrep.notOn += 1;
          } catch {
            s.consultPrep.failed += 1;
          }
        }
      }
    }
  }

  for (const f of firms) {
    if (f.refused) {
      await markInvalid(admin, f.conn.id, f.conn.org_id);
      s.reauthNeeded += 1;
      f.failed = true;
    }
    if (f.failed) s.failedFirms += 1;
  }
  return s;
}
