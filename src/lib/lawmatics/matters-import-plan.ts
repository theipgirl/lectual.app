import { createHash } from "node:crypto";

import type { LawmaticsMatterSourceRecord } from "./matters-normalize";

/**
 * The matters importer's decision engine — PURE, and DELIBERATELY NOT sharing
 * types with ./import-plan.ts (the lead importer's own decision engine). Given
 * sanitized Lawmatics prospects and the tenant's existing matters, it decides
 * what would change and why. It writes nothing and reads nothing;
 * ./matters-import.ts does the I/O on both ends — same preview/apply split
 * import-plan.ts uses, for the same reason: the dry run and the real write
 * call this exact function, so a preview can never drift from what a
 * confirmed apply actually does.
 *
 * Five rules this planner never breaks:
 *
 *   1. NEVER CREATE. Only an existing crm_matter row is ever written to —
 *      there is no create path, unlike the lead importer.
 *   2. Primary match is `lawmatics_id`. Exact and unambiguous by construction.
 *   3. Fallback match is name-based, and ONLY over matters that are not yet
 *      linked to any Lawmatics record (`lawmatics_id IS NULL`) — a matter
 *      already linked to a DIFFERENT prospect is never touched by a name
 *      guess, so a bad match can never steal a matter away from its real
 *      link. Three candidate keys are tried in order — normalized `title`,
 *      then `mark_text`, then `matter_number` — and the FIRST bucket with
 *      EXACTLY ONE candidate wins. Any bucket with two or more candidates for
 *      the same key stops the match immediately: the record is `unmapped`
 *      with an "ambiguous" reason, and later buckets are never tried (a
 *      false "unique" match found downstream of a real ambiguity would be
 *      worse than not matching at all).
 *   4. Claim tracking within one pull. If two incoming records would both
 *      match the same existing matter, the second is `skipped` — never
 *      silently overwritten, never guessed between.
 *   5. Every field write is independently null-only-guarded: `lawmatics_id`,
 *      `referral_source`, `notes`, and `opened_at` are each written only when
 *      the matter's current value is null/blank. A value a human already
 *      typed into the dashboard is never overwritten by this importer.
 *
 * Buckets: `updates` (real field changes) / `unchanged` (matched, nothing to
 * write) / `unmapped` (no match — needs manual review) / `skipped` (no id,
 * duplicate id in the pull, or already claimed by another record in the same
 * pull). Every input record lands in exactly one bucket.
 */

/**
 * An existing crm_matter row, reduced to the fields matching + null-only-fill
 * needs. Loaded via a scoped SELECT in ./matters-import.ts.
 *
 * Schema note: `crm_matter.opened_at` is `NOT NULL DEFAULT now()` as of 0019
 * (see supabase/migrations/0019_matter_activity.sql) — it can never actually
 * be null against the live schema. Typed nullable HERE anyway, for forward-
 * compatibility and so the null-only-fill guard on it is actually unit-
 * testable; the guard is presently unreachable against real data.
 */
export type ExistingMatter = {
  id: string;
  matter_number: string;
  title: string | null;
  mark_text: string | null;
  notes: string | null;
  referral_source: string | null;
  lawmatics_id: string | null;
  opened_at: string | null;
};

export type MatterField = "lawmatics_id" | "referral_source" | "notes" | "opened_at";

export type MatterFieldChange = { field: MatterField; from: string | null; to: string };

export type PlannedMatterUpdate = {
  lawmaticsId: string;
  matterId: string;
  matterNumber: string;
  matterName: string | null;
  matchedBy: "lawmatics_id" | "title" | "mark_text" | "matter_number";
  /** True when this run would attach lawmatics_id to a previously unlinked matter. */
  linksRecord: boolean;
  changes: MatterFieldChange[];
};

export type UnmappedMatterRecord = {
  lawmaticsId: string;
  matterName: string | null;
  reason: string;
};

export type SkippedMatterRecord = {
  lawmaticsId: string;
  matterName: string | null;
  reason: string;
};

export type MattersImportPlan = {
  updates: PlannedMatterUpdate[];
  /** Matched, already current — nothing to write. */
  unchanged: Array<{ lawmaticsId: string; matterId: string; matterName: string | null }>;
  unmapped: UnmappedMatterRecord[];
  skipped: SkippedMatterRecord[];
  totals: {
    sourceRecords: number;
    update: number;
    unchanged: number;
    unmapped: number;
    skipped: number;
  };
  /**
   * Stable hash of every decision in this plan. The confirm step re-derives
   * the plan from scratch and refuses to write if the fingerprint moved — so
   * an operator can only ever approve the plan they were actually shown.
   */
  fingerprint: string;
};

const TWO_RECORDS_ONE_MATTER =
  "Another Lawmatics record in this same pull already matches this matter — this import won't choose between them.";

/**
 * Comparison key — case, punctuation and spacing insensitive, so small
 * spelling/formatting differences ("Verdant Bloom — Wordmark" vs "verdant
 * bloom wordmark") still match. Null when there is nothing to compare.
 * Reimplemented locally (not imported from import-plan.ts's nameKey) per this
 * module's explicit decoupling from the lead importer.
 */
function nameKey(value: string | null | undefined): string | null {
  const v = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return v ? v : null;
}

/** Blank means "nothing recorded" — null, undefined, or an all-whitespace string. */
function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === "";
}

function bucketBy(
  matters: readonly ExistingMatter[],
  key: (m: ExistingMatter) => string | null,
): Map<string, ExistingMatter[]> {
  const map = new Map<string, ExistingMatter[]>();
  for (const m of matters) {
    const k = key(m);
    if (!k) continue;
    const bucket = map.get(k);
    if (bucket) bucket.push(m);
    else map.set(k, [m]);
  }
  return map;
}

/** The field-level writes for a matched matter, each independently null-only-guarded. */
function buildChanges(matter: ExistingMatter, rec: LawmaticsMatterSourceRecord): MatterFieldChange[] {
  const changes: MatterFieldChange[] = [];

  if (isBlank(matter.lawmatics_id)) {
    changes.push({ field: "lawmatics_id", from: matter.lawmatics_id, to: rec.lawmaticsId });
  }
  if (isBlank(matter.referral_source) && rec.referralSource) {
    changes.push({ field: "referral_source", from: matter.referral_source, to: rec.referralSource });
  }
  if (isBlank(matter.notes) && rec.notes) {
    changes.push({ field: "notes", from: matter.notes, to: rec.notes });
  }
  // Presently unreachable against the live schema (opened_at is NOT NULL) —
  // see ExistingMatter's doc comment. Kept for forward-compatibility and so
  // this guard is unit-testable via the widened type.
  if (isBlank(matter.opened_at) && rec.createdAt) {
    changes.push({ field: "opened_at", from: matter.opened_at, to: rec.createdAt });
  }

  return changes;
}

export function planMattersImport(
  records: readonly LawmaticsMatterSourceRecord[],
  existing: readonly ExistingMatter[],
): MattersImportPlan {
  const updates: PlannedMatterUpdate[] = [];
  const unchanged: MattersImportPlan["unchanged"] = [];
  const unmapped: UnmappedMatterRecord[] = [];
  const skipped: SkippedMatterRecord[] = [];

  const byLawmaticsId = new Map<string, ExistingMatter>();
  const unlinked: ExistingMatter[] = [];
  for (const m of existing) {
    if (m.lawmatics_id) byLawmaticsId.set(m.lawmatics_id, m);
    else unlinked.push(m);
  }

  const byTitle = bucketBy(unlinked, (m) => nameKey(m.title));
  const byMarkText = bucketBy(unlinked, (m) => nameKey(m.mark_text));
  const byMatterNumber = bucketBy(unlinked, (m) => nameKey(m.matter_number));

  const seenSourceIds = new Set<string>();
  const claimedMatterIds = new Set<string>();

  for (const rec of records) {
    const base = { lawmaticsId: rec.lawmaticsId, matterName: rec.matterName };

    if (!rec.lawmaticsId) {
      skipped.push({ ...base, reason: "The Lawmatics record has no id — it cannot be re-synced safely." });
      continue;
    }
    if (seenSourceIds.has(rec.lawmaticsId)) {
      skipped.push({ ...base, reason: "Duplicate — this Lawmatics id appeared more than once in the response." });
      continue;
    }
    seenSourceIds.add(rec.lawmaticsId);

    // ── Primary match: already linked ───────────────────────────────────────
    const linked = byLawmaticsId.get(rec.lawmaticsId);
    if (linked) {
      if (claimedMatterIds.has(linked.id)) {
        skipped.push({ ...base, reason: TWO_RECORDS_ONE_MATTER });
        continue;
      }
      claimedMatterIds.add(linked.id);
      const changes = buildChanges(linked, rec);
      if (changes.length === 0) {
        unchanged.push({ lawmaticsId: rec.lawmaticsId, matterId: linked.id, matterName: rec.matterName });
      } else {
        updates.push({
          lawmaticsId: rec.lawmaticsId,
          matterId: linked.id,
          matterNumber: linked.matter_number,
          matterName: rec.matterName,
          matchedBy: "lawmatics_id",
          linksRecord: changes.some((c) => c.field === "lawmatics_id"),
          changes,
        });
      }
      continue;
    }

    // ── Fallback match: unlinked matters only, title → mark_text → matter_number ──
    const key = nameKey(rec.matterName);
    let matched: ExistingMatter | null = null;
    let matchedBy: PlannedMatterUpdate["matchedBy"] | null = null;
    let ambiguousReason: string | null = null;

    if (key) {
      const buckets: Array<[PlannedMatterUpdate["matchedBy"], Map<string, ExistingMatter[]>]> = [
        ["title", byTitle],
        ["mark_text", byMarkText],
        ["matter_number", byMatterNumber],
      ];
      for (const [via, bucket] of buckets) {
        const candidates = bucket.get(key) ?? [];
        if (candidates.length === 1) {
          matched = candidates[0];
          matchedBy = via;
          break;
        }
        if (candidates.length >= 2) {
          ambiguousReason = `Ambiguous — ${candidates.length} matters share this ${via === "title" ? "title" : via === "mark_text" ? "mark" : "matter number"}.`;
          break;
        }
        // Zero candidates in this bucket: try the next one.
      }
    }

    if (matched && matchedBy) {
      if (claimedMatterIds.has(matched.id)) {
        skipped.push({ ...base, reason: TWO_RECORDS_ONE_MATTER });
        continue;
      }
      claimedMatterIds.add(matched.id);
      const changes = buildChanges(matched, rec);
      if (changes.length === 0) {
        unchanged.push({ lawmaticsId: rec.lawmaticsId, matterId: matched.id, matterName: rec.matterName });
      } else {
        updates.push({
          lawmaticsId: rec.lawmaticsId,
          matterId: matched.id,
          matterNumber: matched.matter_number,
          matterName: rec.matterName,
          matchedBy,
          linksRecord: changes.some((c) => c.field === "lawmatics_id"),
          changes,
        });
      }
      continue;
    }

    unmapped.push({
      ...base,
      reason:
        ambiguousReason ??
        "No existing matter found by name/matter number — this importer never creates matters, link it manually.",
    });
  }

  const plan: Omit<MattersImportPlan, "fingerprint"> = {
    updates,
    unchanged,
    unmapped,
    skipped,
    totals: {
      sourceRecords: records.length,
      update: updates.length,
      unchanged: unchanged.length,
      unmapped: unmapped.length,
      skipped: skipped.length,
    },
  };

  return { ...plan, fingerprint: fingerprintMattersPlan(plan) };
}

/**
 * Fingerprint every decision the operator is shown. Order-independent (the
 * per-record lines are sorted) so an unstable API ordering doesn't invalidate
 * an otherwise identical plan, but value-sensitive: any changed field or
 * bucket produces a different hash and forces a fresh preview. Own sha256
 * implementation — not imported from import-plan.ts's fingerprintPlan.
 */
export function fingerprintMattersPlan(plan: Omit<MattersImportPlan, "fingerprint">): string {
  const lines: string[] = [];
  for (const u of plan.updates) {
    lines.push(`update|${u.lawmaticsId}|${u.matterId}|${u.matchedBy}|${JSON.stringify(u.changes)}`);
  }
  for (const u of plan.unchanged) lines.push(`unchanged|${u.lawmaticsId}|${u.matterId}`);
  for (const u of plan.unmapped) lines.push(`unmapped|${u.lawmaticsId}|${u.reason}`);
  for (const s of plan.skipped) lines.push(`skipped|${s.lawmaticsId}|${s.reason}`);
  lines.sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
}
