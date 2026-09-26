import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";

import { LawmaticsApiError, type LawmaticsClient } from "./client";
import { firmLawmaticsClient } from "./connection";
import {
  DEFAULT_PLAN_OPTIONS,
  planImport,
  type ExistingLead,
  type ImportPlan,
  type PlanOptions,
  type SkippedRecord,
  type StageDivergence,
  type UnmappedRecord,
} from "./import-plan";
import {
  mergeContact,
  normalizeContact,
  normalizeProspect,
  type LawmaticsSourceContact,
  type LawmaticsSourceRecord,
} from "./normalize";
import type { StageRef } from "./stage-map";

/**
 * One-way Lawmatics → Lectual importer (orchestration layer).
 *
 * Reads the firm's real book of business out of Lawmatics and lands it in
 * `crm_lead`. Nothing here runs on its own: `previewImport()` is triggered by an
 * explicit click, and `applyImport()` refuses to write unless it is handed the
 * fingerprint of a plan that still matches what the operator was shown.
 *
 * TENANCY: every database call goes through `getScopedClient()`, so RLS
 * (`org_id = public.current_org_id()`) is the boundary for both the read of
 * existing leads and the writes. There is no service-role path in this module —
 * an importer that bypassed RLS would be the single easiest way to cross-write
 * one firm's clients into another's pipeline.
 *
 * DIRECTION: strictly one-way. The client is read-only (see client.ts) — this
 * code cannot modify anything in Lawmatics.
 */

const PROSPECTS_PATH = "/prospects";
const CONTACTS_PATH = "/contacts";
// stage/practice_area/contact are JSON:API relationships, not attributes — they
// only materialize when sideloaded.
const PROSPECT_INCLUDE = "stage,practice_area,contact";

type LeadRow = Database["public"]["Tables"]["crm_lead"]["Row"];
type LeadInsert = Database["public"]["Tables"]["crm_lead"]["Insert"];
type Scoped = SupabaseClient<Database>;

export type ConnectionStatus =
  | { connected: true }
  | { connected: false; reason: string };

export type PreviewResult = {
  fetchedAt: string;
  plan: ImportPlan;
  counts: { prospects: number; contacts: number };
  /** True when a safety cap or an ignored pagination param cut the pull short. */
  truncated: boolean;
  truncatedReason?: string;
  /**
   * The pull could not sideload relationships, so stage/contact came back null
   * for EVERY record. Distinct from `truncated`: the count is complete, which
   * is exactly what makes it dangerous — the plan then reports every record as
   * having no stage, indistinguishable from the firm genuinely not using
   * pipeline stages.
   */
  includeDropped: boolean;
  includeDroppedReason?: string;
  /** Stage names the tenant actually has — shown so mapping gaps are obvious. */
  stageNames: string[];
};

export type ImportFailure = {
  lawmaticsId: string;
  action: "create" | "update";
  message: string;
};

export type ImportReport = {
  startedAt: string;
  finishedAt: string;
  fingerprint: string;
  created: number;
  updated: number;
  /** Existing local leads newly linked to a Lawmatics record. */
  linked: number;
  /** Leads whose stage was moved (only when the operator opted in). */
  stageMoves: number;
  unchanged: number;
  /** Stage disagreements left alone (the operator didn't opt into moves). */
  divergences: StageDivergence[];
  unmapped: UnmappedRecord[];
  skipped: SkippedRecord[];
  failures: ImportFailure[];
  /** Carried through from the pull so a partial import is never read as total. */
  truncated: boolean;
  truncatedReason?: string;
  /**
   * True when the run stopped on its own time budget rather than finishing.
   * Everything counted above WAS written and is durable; `remaining` is what
   * this run did not get to.
   *
   * This exists because the apply is not transactional and cannot be: it is a
   * sequence of individual RLS-scoped statements, so a serverless timeout
   * mid-way used to leave committed rows behind and return NOTHING — no
   * counts, no failure list, no idea where it stopped. Stopping deliberately,
   * just short of the platform limit, turns that into an honest report plus a
   * safe "run it again" (the plan is derived from the DB each time, so records
   * already written come back as no-op updates).
   */
  partial: boolean;
  /** Only meaningful when `partial` — what this run did not reach. */
  remaining: { creates: number; updates: number };
};

// The client is built from the calling firm's OWN token: see ./connection.ts.

// ── Source side ──────────────────────────────────────────────────────────────

export type SourcePull = {
  records: LawmaticsSourceRecord[];
  contactCount: number;
  truncated: boolean;
  truncatedReason?: string;
  /**
   * The prospects pull had to drop its `include`, so stage/contact
   * relationships were never fetched. Kept SEPARATE from `truncated` because
   * the record count is complete — only the related fields are missing, which
   * makes every record look stage-less rather than looking broken.
   */
  includeDropped: boolean;
  includeDroppedReason?: string;
};

/**
 * Pull prospects (Lawmatics' name for Matters — `/matters` does not exist) and
 * enrich them from `/contacts`. Contacts are only ever used to fill gaps; a
 * contact that belongs to no prospect is counted but not imported, because a
 * standalone address-book entry is not a matter in the firm's pipeline.
 */
export async function pullSource(client: LawmaticsClient): Promise<SourcePull> {
  const prospects = await client.listAll(PROSPECTS_PATH, { include: PROSPECT_INCLUDE });

  let contactsById = new Map<string, LawmaticsSourceContact>();
  let contactCount = 0;
  let truncated = prospects.truncated;
  let truncatedReason = prospects.truncatedReason;

  try {
    const contacts = await client.listAll(CONTACTS_PATH);
    contactCount = contacts.records.length;
    contactsById = new Map(
      contacts.records
        .map((rec) => normalizeContact(rec))
        .filter((c): c is LawmaticsSourceContact => c !== null)
        .map((c) => [c.lawmaticsId, c]),
    );
    if (contacts.truncated && !truncated) {
      truncated = true;
      truncatedReason = contacts.truncatedReason;
    }
  } catch (err) {
    // Contacts are an enrichment, not the source of truth. If that call fails,
    // import what the prospects themselves carry rather than aborting — and say
    // so, so missing emails are read as "we couldn't fetch them", not "absent".
    truncated = true;
    truncatedReason = `Contact details could not be fetched (${describe(err)}); some records may be missing an email or phone.`;
  }

  const records: LawmaticsSourceRecord[] = [];
  for (const raw of prospects.records) {
    const normalized = normalizeProspect(raw, prospects.included);
    if (!normalized) continue;
    records.push(
      mergeContact(
        normalized,
        normalized.contactId ? contactsById.get(normalized.contactId) : undefined,
      ),
    );
  }

  return {
    records,
    contactCount,
    truncated,
    truncatedReason,
    includeDropped: prospects.includeDropped,
    includeDroppedReason: prospects.includeDroppedReason,
  };
}

// ── Destination side ─────────────────────────────────────────────────────────

/** The active org's stages. RLS scopes the rows; no org filter is applied here. */
async function loadStages(supabase: Scoped): Promise<StageRef[]> {
  const { data, error } = await supabase
    .from("crm_stage")
    .select("id,name")
    .order("order_index", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Every lead in the active org, paged past PostgREST's 1000-row default so a
 * firm with a large book doesn't get phantom "create" rows for leads that are
 * simply beyond the first page.
 */
async function loadExistingLeads(supabase: Scoped, maxRows = 20_000): Promise<ExistingLead[]> {
  const pageSize = 1000;
  const rows: ExistingLead[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await supabase
      .from("crm_lead")
      .select(
        "id,email,first_name,last_name,phone,business_name,website,current_stage_id,lawmatics_id,practice_area,referral_source,referral_detail",
      )
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ExistingLead[];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

// ── Preview (dry run) ────────────────────────────────────────────────────────

/**
 * Build the plan WITHOUT writing anything. Called by the explicit "preview"
 * action only — never on page load.
 */
export async function previewImport(
  options: PlanOptions = DEFAULT_PLAN_OPTIONS,
): Promise<PreviewResult> {
  const client = await firmLawmaticsClient();
  const supabase = await getScopedClient();

  const [source, stages, existing] = await Promise.all([
    pullSource(client),
    loadStages(supabase),
    loadExistingLeads(supabase),
  ]);

  return {
    fetchedAt: new Date().toISOString(),
    plan: planImport(source.records, stages, existing, options),
    counts: { prospects: source.records.length, contacts: source.contactCount },
    truncated: source.truncated,
    truncatedReason: source.truncatedReason,
    includeDropped: source.includeDropped,
    includeDroppedReason: source.includeDroppedReason,
    stageNames: stages.map((s) => s.name),
  };
}

// ── Apply (the only write path) ──────────────────────────────────────────────

export class PlanChangedError extends Error {
  constructor(readonly preview: PreviewResult) {
    super(
      "The Lawmatics data changed since this preview was generated. Nothing was written — review the refreshed preview and confirm again.",
    );
    this.name = "PlanChangedError";
  }
}

/**
 * Re-derive the plan from scratch and write it, but only if it still matches
 * the fingerprint the operator approved.
 *
 * The plan is NOT accepted from the caller. Everything written here is
 * recomputed server-side from Lawmatics and the database; the fingerprint is
 * the only thing the browser contributes, and it can only ever cause a refusal,
 * never a different write. That closes the obvious hole in a two-step confirm —
 * a hand-crafted POST cannot inject lead rows or redirect them to another org's
 * stage ids, because it supplies no data at all.
 */
/**
 * How long an apply may run before it stops itself, in ms.
 *
 * Must stay comfortably BELOW the route's `maxDuration` (see the import
 * page's segment config). The gap is deliberate headroom: the run needs time
 * after the last write to build and return the report, and a report is the
 * whole point — a platform kill returns nothing at all.
 */
const APPLY_BUDGET_MS = 45_000;

export async function applyImport(
  expectedFingerprint: string,
  options: PlanOptions = DEFAULT_PLAN_OPTIONS,
  budgetMs: number = APPLY_BUDGET_MS,
): Promise<ImportReport> {
  // The clock starts HERE, not after the pull: previewImport re-fetches the
  // whole book from Lawmatics, which on a large firm is the most expensive
  // thing this function does. Budgeting only the writes would let the pull
  // eat the entire window and still get killed.
  const deadline = Date.now() + budgetMs;
  const outOfTime = () => Date.now() >= deadline;

  const startedAt = new Date().toISOString();
  const preview = await previewImport(options);
  const plan = preview.plan;

  if (plan.fingerprint !== expectedFingerprint) throw new PlanChangedError(preview);

  const supabase = await getScopedClient();
  const { data: orgId, error: orgError } = await supabase.rpc("current_org_id");
  if (orgError) throw orgError;
  if (!orgId || typeof orgId !== "string") {
    throw new Error("No active org — refusing to import.");
  }

  const syncedAt = new Date().toISOString();
  const failures: ImportFailure[] = [];
  let created = 0;
  let updated = 0;
  let linked = 0;
  let stageMoves = 0;

  // ── Creates ────────────────────────────────────────────────────────────────
  // org_id is set explicitly because the column has no default; the RLS WITH
  // CHECK still requires it to equal current_org_id(), so a wrong value is
  // rejected by the database rather than trusted from here.
  const inserts: LeadInsert[] = plan.creates.map((c) => ({
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
    lawmatics_synced_at: syncedAt,
    // Preserve when the matter actually started; leave stage_entered_at to
    // default to now() — we know when Lawmatics created the record, not when it
    // entered its current stage, and inventing that would corrupt stage aging.
    ...(c.createdAt ? { created_at: c.createdAt } : {}),
    ...(c.lastActivityAt ? { last_activity_at: c.lastActivityAt } : {}),
  }));

  let partial = false;
  let createsDone = 0;

  const CHUNK = 50;
  for (let i = 0; i < inserts.length; i += CHUNK) {
    // Checked BETWEEN chunks, never mid-chunk: a chunk is a single statement
    // and is all-or-nothing at the database, so stopping here always leaves a
    // whole number of records written.
    if (outOfTime()) {
      partial = true;
      break;
    }
    const chunk = inserts.slice(i, i + CHUNK);
    createsDone = i + chunk.length;
    const { error } = await supabase.from("crm_lead").insert(chunk);
    if (!error) {
      created += chunk.length;
      continue;
    }
    // One bad row fails the whole statement — retry individually so a single
    // rejected record can be named in the report instead of losing 49 good ones.
    for (const row of chunk) {
      const { error: rowError } = await supabase.from("crm_lead").insert(row);
      if (rowError) {
        failures.push({
          lawmaticsId: row.lawmatics_id ?? "(unknown)",
          action: "create",
          message: rowError.message,
        });
      } else {
        created += 1;
      }
    }
  }

  // ── Updates ────────────────────────────────────────────────────────────────
  // One round trip per record, sequentially. Kept sequential on purpose: each
  // failure has to be attributable to a named record in the report, and the
  // deadline check below is what bounds the wall-clock cost rather than
  // concurrency.
  let updatesDone = 0;
  for (const u of plan.updates) {
    if (outOfTime()) {
      partial = true;
      break;
    }
    updatesDone += 1;
    const patch: Database["public"]["Tables"]["crm_lead"]["Update"] = {
      lawmatics_id: u.lawmaticsId,
      lawmatics_synced_at: syncedAt,
      updated_at: syncedAt,
    };
    for (const change of u.changes) {
      assignChange(patch, change.field, change.to);
    }
    if (u.stageWillMove && u.targetStageId) {
      patch.current_stage_id = u.targetStageId;
      patch.stage_entered_at = syncedAt;
    }

    // RLS scopes the row to the caller's org; the id came from a read through
    // that same policy, so this cannot reach another tenant's lead.
    const { error } = await supabase.from("crm_lead").update(patch).eq("id", u.leadId);
    if (error) {
      failures.push({ lawmaticsId: u.lawmaticsId, action: "update", message: error.message });
      continue;
    }
    updated += 1;
    if (u.linksRecord) linked += 1;
    if (u.stageWillMove) stageMoves += 1;
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprint: plan.fingerprint,
    created,
    updated,
    linked,
    stageMoves,
    unchanged: plan.unchanged.length,
    divergences: plan.divergences,
    unmapped: plan.unmapped,
    skipped: plan.skipped,
    failures,
    truncated: preview.truncated,
    truncatedReason: preview.truncatedReason,
    partial,
    remaining: {
      creates: Math.max(0, inserts.length - createsDone),
      updates: Math.max(0, plan.updates.length - updatesDone),
    },
  };
}

/** Narrow, exhaustive field assignment — no dynamic key writes into the patch. */
function assignChange(
  patch: Database["public"]["Tables"]["crm_lead"]["Update"],
  field: keyof Pick<
    LeadRow,
    | "first_name"
    | "last_name"
    | "email"
    | "phone"
    | "business_name"
    | "website"
    | "practice_area"
    | "referral_source"
    | "referral_detail"
  >,
  value: string,
): void {
  switch (field) {
    case "first_name":
      patch.first_name = value;
      return;
    case "last_name":
      patch.last_name = value;
      return;
    case "email":
      patch.email = value;
      return;
    case "phone":
      patch.phone = value;
      return;
    case "business_name":
      patch.business_name = value;
      return;
    case "website":
      patch.website = value;
      return;
    case "practice_area":
      patch.practice_area = value;
      return;
    case "referral_source":
      patch.referral_source = value;
      return;
    case "referral_detail":
      patch.referral_detail = value;
      return;
  }
}

export function describe(err: unknown): string {
  if (err instanceof LawmaticsApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}
