import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getScopedClient } from "@/lib/db/scoped-client";
import type { Database } from "@/lib/db/types";

import { type LawmaticsClient } from "./client";
import { firmLawmaticsClient } from "./connection";
import {
  planMattersImport,
  type ExistingMatter,
  type MattersImportPlan,
  type SkippedMatterRecord,
  type UnmappedMatterRecord,
} from "./matters-import-plan";
import { normalizeMatterProspect, type LawmaticsMatterSourceRecord } from "./matters-normalize";

/**
 * One-way Lawmatics → Lectual matters reconciliation importer.
 *
 * Fully self-contained — own `requireClient`/`readToken`/`readBaseUrl`/
 * `mattersConnectionStatus`, own `PROSPECTS_PATH` constant — deliberately NOT
 * sharing state with ./import.ts (the lead importer). The only thing the
 * caller (this route's server actions) reuses from that module is
 * `describe()`, a trivial cross-cutting error formatter that isn't part of
 * either importer's plan shape.
 *
 * UPDATE-EXISTING-ONLY: there is no create path. This importer's job is to
 * backfill lawmatics_id / referral_source / notes / opened_at onto a
 * crm_matter row that already exists in this firm's pipeline — see
 * ./matters-import-plan.ts for the full matching contract.
 *
 * NO `include` PARAM: unlike the lead importer, nothing this module reads is
 * a JSON:API relationship (no stage/contact needed) — a deliberate
 * simplification, not an oversight.
 *
 * TENANCY: every database call goes through `getScopedClient()`. There is no
 * service-role path here, and there is no explicit org_id write-time check
 * the way ./import.ts's CREATE path needs one — because there is no create
 * path. Every matter id this module ever writes to came from an RLS-scoped
 * read, so a cross-tenant write is structurally impossible.
 *
 * DIRECTION: strictly one-way. The client is read-only (see client.ts).
 */

const PROSPECTS_PATH = "/prospects";

type Scoped = SupabaseClient<Database>;

export type MattersConnectionStatus =
  | { connected: true }
  | { connected: false; reason: string };

export type MattersPreviewResult = {
  fetchedAt: string;
  plan: MattersImportPlan;
  counts: { prospects: number };
  /** True when a safety cap or an ignored pagination param cut the pull short. */
  truncated: boolean;
  truncatedReason?: string;
};

export type MattersImportFailure = {
  lawmaticsId: string;
  message: string;
};

export type MattersImportReport = {
  startedAt: string;
  finishedAt: string;
  fingerprint: string;
  updated: number;
  /** Existing local matters newly linked to a Lawmatics record. */
  linked: number;
  unchanged: number;
  unmapped: UnmappedMatterRecord[];
  skipped: SkippedMatterRecord[];
  failures: MattersImportFailure[];
  /** Carried through from the pull so a partial import is never read as total. */
  truncated: boolean;
  truncatedReason?: string;
  /**
   * True when the run stopped on its own time budget rather than finishing.
   * Everything counted above WAS written and is durable — same contract as
   * ./import.ts's ImportReport.partial.
   */
  partial: boolean;
  /** Only meaningful when `partial` — how many planned updates this run did not reach. */
  remaining: { updates: number };
};

// The client is built from the calling firm's OWN token: see ./connection.ts.

// ── Source side ──────────────────────────────────────────────────────────────

export type MattersSourcePull = {
  records: LawmaticsMatterSourceRecord[];
  truncated: boolean;
  truncatedReason?: string;
};

/** Pull prospects (Lawmatics' name for Matters) with no relationship sideload. */
export async function pullMattersSource(client: LawmaticsClient): Promise<MattersSourcePull> {
  const prospects = await client.listAll(PROSPECTS_PATH);

  const records: LawmaticsMatterSourceRecord[] = [];
  for (const raw of prospects.records) {
    const normalized = normalizeMatterProspect(raw);
    if (normalized) records.push(normalized);
  }

  return {
    records,
    truncated: prospects.truncated,
    truncatedReason: prospects.truncatedReason,
  };
}

// ── Destination side ─────────────────────────────────────────────────────────

/**
 * Every matter in the active org, reduced to the columns the planner needs,
 * paged past PostgREST's 1000-row default so a firm with a large book doesn't
 * get phantom "unmapped" rows for matters simply beyond the first page.
 */
export async function loadExistingMatters(
  supabase: Scoped,
  maxRows = 20_000,
): Promise<ExistingMatter[]> {
  const pageSize = 1000;
  const rows: ExistingMatter[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await supabase
      .from("crm_matter")
      .select("id,matter_number,title,mark_text,notes,referral_source,lawmatics_id,opened_at")
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []) as ExistingMatter[];
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
export async function previewMattersImport(): Promise<MattersPreviewResult> {
  const client = await firmLawmaticsClient();
  const supabase = await getScopedClient();

  const [source, existing] = await Promise.all([
    pullMattersSource(client),
    loadExistingMatters(supabase),
  ]);

  return {
    fetchedAt: new Date().toISOString(),
    plan: planMattersImport(source.records, existing),
    counts: { prospects: source.records.length },
    truncated: source.truncated,
    truncatedReason: source.truncatedReason,
  };
}

// ── Apply (the only write path) ──────────────────────────────────────────────

export class MattersPlanChangedError extends Error {
  constructor(readonly preview: MattersPreviewResult) {
    super(
      "The Lawmatics data changed since this preview was generated. Nothing was written — review the refreshed preview and confirm again.",
    );
    this.name = "MattersPlanChangedError";
  }
}

/**
 * How long an apply may run before it stops itself, in ms. Must stay
 * comfortably below the import page's `maxDuration` segment config — same
 * headroom reasoning as ./import.ts's APPLY_BUDGET_MS.
 */
const APPLY_BUDGET_MS = 45_000;

/**
 * Re-derive the plan from scratch and write it, but only if it still matches
 * the fingerprint the operator approved. Same refusal contract as
 * ./import.ts's applyImport — the plan is never accepted from the caller,
 * only the fingerprint, which can only ever cause a refusal.
 */
export async function applyMattersImport(
  expectedFingerprint: string,
  budgetMs: number = APPLY_BUDGET_MS,
): Promise<MattersImportReport> {
  const deadline = Date.now() + budgetMs;
  const outOfTime = () => Date.now() >= deadline;

  const startedAt = new Date().toISOString();
  const preview = await previewMattersImport();
  const plan = preview.plan;

  if (plan.fingerprint !== expectedFingerprint) throw new MattersPlanChangedError(preview);

  const supabase = await getScopedClient();

  const syncedAt = new Date().toISOString();
  const failures: MattersImportFailure[] = [];
  let updated = 0;
  let linked = 0;
  let partial = false;
  let updatesDone = 0;

  // One round trip per record, sequentially — each failure has to be
  // attributable to a named record in the report, mirroring ./import.ts's
  // updates loop. No `logActivity()` per row: matches ./import.ts's own
  // precedent of not logging activity for bulk importer writes (only
  // human-initiated edits like updateMatterIpFields do).
  for (const u of plan.updates) {
    if (outOfTime()) {
      partial = true;
      break;
    }
    updatesDone += 1;

    const patch: Database["public"]["Tables"]["crm_matter"]["Update"] = {
      lawmatics_synced_at: syncedAt,
      updated_at: syncedAt,
    };
    for (const change of u.changes) assignChange(patch, change.field, change.to);

    // RLS scopes the row to the caller's org; the id came from a read through
    // that same policy, so this cannot reach another tenant's matter.
    const { error } = await supabase.from("crm_matter").update(patch).eq("id", u.matterId);
    if (error) {
      failures.push({ lawmaticsId: u.lawmaticsId, message: error.message });
      continue;
    }
    updated += 1;
    if (u.linksRecord) linked += 1;
  }

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    fingerprint: plan.fingerprint,
    updated,
    linked,
    unchanged: plan.unchanged.length,
    unmapped: plan.unmapped,
    skipped: plan.skipped,
    failures,
    truncated: preview.truncated,
    truncatedReason: preview.truncatedReason,
    partial,
    remaining: { updates: Math.max(0, plan.updates.length - updatesDone) },
  };
}

/** Narrow, exhaustive field assignment — no dynamic key writes into the patch. */
function assignChange(
  patch: Database["public"]["Tables"]["crm_matter"]["Update"],
  field: "lawmatics_id" | "referral_source" | "notes" | "opened_at",
  value: string,
): void {
  switch (field) {
    case "lawmatics_id":
      patch.lawmatics_id = value;
      return;
    case "referral_source":
      patch.referral_source = value;
      return;
    case "notes":
      patch.notes = value;
      return;
    case "opened_at":
      patch.opened_at = value;
      return;
  }
}

