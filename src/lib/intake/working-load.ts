import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { readProposalExpiries } from "@/lib/review/load";
import type { LeadPendingApprovals } from "./pending-approvals";
import { leadsWithLiveProposal, type FactSet, type WorkingFacts } from "./working";

/**
 * The reads behind the Leads page's Working rule (rules in `working.ts`). Scoped client only (RLS on
 * the active org); no service role, no write, nothing logged with a name or address. Each source is
 * read on its own and answers `ok` / `skipped` / `unavailable`: a read that failed is NEVER an empty set.
 *
 * Reads this computation ADDS to the Leads page (everything else is passed in or reused):
 *   1. activity   ONE query shape on `crm_activity`, `lead_id` only, run once per chunk of 100 lead ids
 *                 (so ~4 round trips for 310 leads, in parallel), each paged 1,000 rows at a time.
 *   2. proposals  `readProposalExpiries` (the weekly review's own read): `client_proposal` by lead id,
 *                 chunks of 80, the columns id, family_id, version, status, lead_id, matter_id, expires_on.
 *   3. consults   its OWN scoped query on `crm_calendar_event`: `is_consult = true`, `lead_id` not null, `starts_at`
 *                 from now on, `lead_id` only, paged. Never the calendar page's read (that one covers every event and
 *                 is capped at 500, which a busy calendar would hit). Only with the Mailboxes feature on.
 *   4. booth      `crm_booth_scorecard`, `lead_id` only, paged. Distinct leads in JS.
 * Approvals add NO read: the page already holds `loadPendingApprovalsByLead()`'s result and passes it in.
 *
 * QUERY COST of the activity read. It returns one row per qualifying activity row, not one per lead
 * (PostgREST has no DISTINCT), so rows returned = emails + calls + notes + voice notes + person stage
 * moves for the open leads. Estimate for RPB today (310 leads, ~25 with activity): a few hundred rows,
 * one or two pages per chunk. The cost grows with mail volume, so each chunk has a page budget
 * (`ACTIVITY_MAX_PAGES` x 1,000 = 10,000 rows); a chunk that runs out FAILS the read (`unavailable`)
 * rather than return what it has, because a truncated read would call a worked lead "Not started".
 * The index it wants lives in `theipgirl/lectual` (no migrations here): `crm_activity (lead_id, type)`
 * (an index on lead_id alone is enough for the `in (...)` fetch; the type filter then runs on the
 * matched rows). Without it the read is a scan of the firm's activity rows, which is fine at RPB's size.
 */

export const ACTIVITY_PAGE = 1000;
export const ACTIVITY_MAX_PAGES = 10;
export const LEAD_ID_CHUNK = 100;
export const BOOTH_MAX_PAGES = 20;
export const CONSULT_MAX_PAGES = 10;

/** The activity types that are real contact, whoever made them. */
export const REAL_ACTIVITY_TYPES = ["email_sent", "email_received", "call_logged", "note", "voice_note"] as const;

/**
 * One PostgREST `or`. Mail counts whoever wrote it (the mailbox sync writes `email_sent` / `email_received` as
 * `system`). A call, note or voice note counts only when a PERSON wrote it: the public intake form files its
 * answers as a `note` with `actor_type = system`, and that is not work on the lead. A stage move counts only
 * when a person made it (`actor_type = user`, no `payload.actor` stamp): the Stage Keeper writes `ai` +
 * `agent:stage-keeper`, the hired-matter sync `system` + `lawmatics-sync`, imports `system`, automations
 * `automation`. A person's accept or undo of a Stage Keeper card is theirs (`user`, no stamp) and counts.
 */
export const REAL_ACTIVITY_FILTER = `type.in.(email_sent,email_received),and(type.in.(call_logged,note,voice_note),actor_type.eq.user),and(type.eq.stage_changed,actor_type.eq.user,payload->>actor.is.null)`;

type Row = Record<string, unknown>;
type Page = PromiseLike<{ data: Row[] | null; error: unknown }>;
/** The narrow slice of the scoped client this module uses (so tests can hand in a fake). */
export type WorkingDb = {
  from(table: string): {
    select(columns: string): {
      in(column: string, values: readonly string[]): ActivityQuery;
      not(column: string, op: string, value: unknown): BoothQuery;
      eq(column: string, value: unknown): ConsultQuery;
    };
  };
};
type ActivityQuery = {
  or(filter: string): { order(column: string): { range(from: number, to: number): Page } };
};
type ConsultQuery = {
  not(column: string, op: string, value: unknown): {
    gte(column: string, value: string): { order(column: string): { range(from: number, to: number): Page } };
  };
};
type BoothQuery = { order(column: string): { range(from: number, to: number): Page } };

function chunksOf<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Lead ids with real activity. Throws when any page fails or a chunk runs out of page budget. */
export async function readRealActivityLeadIds(db: WorkingDb, leadIds: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  const parts = await Promise.all(
    chunksOf(leadIds, LEAD_ID_CHUNK).map(async (chunk) => {
      const ids = new Set<string>();
      for (let i = 0; i < ACTIVITY_MAX_PAGES; i++) {
        const { data, error } = await db
          .from("crm_activity")
          .select("lead_id")
          .in("lead_id", chunk)
          .or(REAL_ACTIVITY_FILTER)
          .order("id")
          .range(i * ACTIVITY_PAGE, i * ACTIVITY_PAGE + ACTIVITY_PAGE - 1);
        if (error) throw new Error("activity read failed");
        const rows = data ?? [];
        for (const r of rows) if (typeof r.lead_id === "string") ids.add(r.lead_id);
        if (rows.length < ACTIVITY_PAGE) return ids;
      }
      throw new Error("activity read exceeded its page budget");
    }),
  );
  for (const p of parts) for (const id of p) found.add(id);
  return found;
}

/** Lead ids with a booth scorecard row (`lead_id` only; never answers, consent or event data). */
export async function readBoothLeadIds(db: WorkingDb): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < BOOTH_MAX_PAGES; i++) {
    const { data, error } = await db
      .from("crm_booth_scorecard")
      .select("lead_id")
      .not("lead_id", "is", null)
      .order("id")
      .range(i * ACTIVITY_PAGE, i * ACTIVITY_PAGE + ACTIVITY_PAGE - 1);
    if (error) throw new Error("booth read failed");
    const rows = data ?? [];
    for (const r of rows) if (typeof r.lead_id === "string") found.add(r.lead_id);
    if (rows.length < ACTIVITY_PAGE) return found;
  }
  throw new Error("booth read exceeded its page budget");
}

/** Lead ids with a booked (future) consult. Throws when a page fails; before lectual 0098 (no columns) it is `null`. */
export async function readConsultLeadIds(db: WorkingDb, now: Date): Promise<Set<string> | null> {
  const found = new Set<string>();
  for (let i = 0; i < CONSULT_MAX_PAGES; i++) {
    const { data, error } = await db
      .from("crm_calendar_event")
      .select("lead_id")
      .eq("is_consult", true)
      .not("lead_id", "is", null)
      .gte("starts_at", now.toISOString())
      .order("starts_at")
      .range(i * ACTIVITY_PAGE, i * ACTIVITY_PAGE + ACTIVITY_PAGE - 1);
    if (error) {
      const code = (error as { code?: string }).code;
      if (code === "42703" || code === "PGRST204" || code === "42P01" || code === "PGRST205") return null;
      throw new Error("consult read failed");
    }
    const rows = data ?? [];
    for (const r of rows) if (typeof r.lead_id === "string") found.add(r.lead_id);
    if (rows.length < ACTIVITY_PAGE) return found;
  }
  throw new Error("consult read exceeded its page budget");
}

/** The queue's three states as a fact set: no queue connected means nothing can be pending. */
export function approvalsFact(read: LeadPendingApprovals): FactSet {
  if (read.status === "ok") {
    return { status: "ok", leadIds: new Set(Object.entries(read.byLead).filter(([, list]) => list.length > 0).map(([id]) => id)) };
  }
  return read.status === "unconfigured" ? { status: "skipped" } : { status: "unavailable" };
}

export type WorkingFactsDeps = {
  db: WorkingDb;
  now: Date;
  readProposals: (leadIds: readonly string[]) => Promise<{ family_id: string; version: number; status: string; lead_id: string | null }[]>;
};

async function settle(read: () => Promise<FactSet>): Promise<FactSet> {
  try {
    return await read();
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Every fact the classifier needs. Never throws; each source is reported on its own.
 * `approvals` is the result the page already loaded. `mailboxOn` is the Mailboxes feature (Outlook
 * consults exist only with it; off = `skipped`, not "no consult").
 */
export async function loadWorkingFacts(
  opts: { leadIds: readonly string[]; approvals: LeadPendingApprovals; mailboxOn: boolean },
  deps?: WorkingFactsDeps,
): Promise<WorkingFacts> {
  let d = deps;
  if (!d) {
    const db = (await getScopedClient()) as unknown as WorkingDb;
    d = {
      db,
      now: new Date(),
      readProposals: (ids) => readProposalExpiries(db as never, [], ids),
    };
  }
  const live = d;
  const { leadIds } = opts;

  const [activity, proposals, consults, booth] = await Promise.all([
    settle(async () => ({ status: "ok", leadIds: await readRealActivityLeadIds(live.db, leadIds) })),
    settle(async () => ({ status: "ok", leadIds: leadsWithLiveProposal(await live.readProposals(leadIds)) })),
    settle(async (): Promise<FactSet> => {
      if (!opts.mailboxOn) return { status: "skipped" };
      const ids = await readConsultLeadIds(live.db, live.now);
      return ids ? { status: "ok", leadIds: ids } : { status: "skipped" };
    }),
    settle(async () => ({ status: "ok", leadIds: await readBoothLeadIds(live.db) })),
  ]);

  return { activity, approvals: approvalsFact(opts.approvals), proposals, consults, booth };
}
