import { createHash } from "node:crypto";

import { classifyReferralSource } from "@/lib/intake/referral-source";

import type { LawmaticsSourceRecord } from "./normalize";
import { resolveStage, type StageRef } from "./stage-map";

/**
 * The importer's decision engine — PURE. Given sanitized Lawmatics records,
 * the tenant's stages, and the tenant's existing leads, it decides what would
 * happen and why. It writes nothing and reads nothing; `import.ts` does the
 * I/O on both ends. That split is what makes the dry run trustworthy: the
 * preview and the real run call this same function, so the preview is not a
 * separate code path that can drift from what the write actually does.
 *
 * Three rules the planner never breaks:
 *   1. Never invent a stage. Unresolvable → the record is NOT imported and is
 *      listed in `unmapped` with the offending stage name.
 *   2. Never silently drop a record. Everything lands in exactly one bucket —
 *      create / update / unchanged / unmapped / skipped — and every non-import
 *      bucket carries a human-readable reason.
 *   3. Never duplicate. Matching is by `lawmatics_id` first; an unlinked local
 *      lead with the same email is adopted (linked), not cloned. Ambiguity is
 *      reported, never resolved by guessing.
 */

/** An existing crm_lead row, reduced to the fields matching needs. */
export type ExistingLead = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  phone: string | null;
  business_name: string | null;
  website: string | null;
  current_stage_id: string;
  lawmatics_id: string | null;
  /** Intake-dashboard columns (0055) — same fill-blank-only treatment as every other field. */
  practice_area: string | null;
  referral_source: string | null;
  referral_detail: string | null;
};

/** Lead columns this importer is allowed to write. Nothing else is touched. */
export type LeadWriteFields = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string | null;
  business_name: string | null;
  website: string | null;
  /** Verbatim `practice_area` off the Lawmatics record — `'Trademark'`, etc. */
  practice_area: string | null;
  /** Canonical bucket, only ever set when the source record actually named one (§4.2). */
  referral_source: string | null;
  /** Verbatim source text, for the tooltip/search. */
  referral_detail: string | null;
};

export type FieldChange = { field: keyof LeadWriteFields; from: string | null; to: string };

export type PlannedCreate = {
  lawmaticsId: string;
  matterName: string | null;
  fields: LeadWriteFields;
  stageId: string;
  stageName: string;
  /** How the stage was resolved — "alias" means a documented equivalence. */
  stageVia: "exact" | "alias";
  sourceStageName: string | null;
  createdAt: string | null;
  lastActivityAt: string | null;
};

export type PlannedUpdate = {
  lawmaticsId: string;
  leadId: string;
  matterName: string | null;
  matchedBy: "lawmatics_id" | "email";
  /** True when this run would attach lawmatics_id to a previously local lead. */
  linksRecord: boolean;
  changes: FieldChange[];
  /**
   * Changes Lawmatics wanted to make that would have overwritten a non-empty
   * local value, withheld because `overwriteEditedFields` is off. Reported,
   * never written — the update-vs-report split the stage already had.
   */
  heldBackChanges: FieldChange[];
  sourceStageName: string | null;
  /** Resolved target stage, when the Lawmatics stage maps to one. */
  targetStageId: string | null;
  targetStageName: string | null;
  /** Lawmatics and Lectual disagree about where this lead sits. */
  stageDiverges: boolean;
  /** Only true when the operator explicitly opted into stage moves. */
  stageWillMove: boolean;
  /** Set when the stage could not be resolved (informational on an update). */
  stageNote: string | null;
};

export type UnmappedRecord = {
  lawmaticsId: string;
  matterName: string | null;
  name: string | null;
  email: string | null;
  sourceStageName: string | null;
  reason: string;
};

export type SkippedRecord = {
  lawmaticsId: string;
  matterName: string | null;
  name: string | null;
  email: string | null;
  reason: string;
};

export type PlanOptions = {
  /**
   * Move already-imported leads to their Lawmatics stage. OFF by default: a
   * re-run must not undo a stage change an attorney made inside Lectual. When
   * off, divergences are reported so a human can decide.
   */
  moveExistingStages: boolean;
  /**
   * Overwrite a lead field that already holds a DIFFERENT non-empty value in
   * Lectual. OFF by default, for exactly the reason `moveExistingStages` is
   * off: a re-run must not undo an edit a human made here.
   *
   * The stage was protected from the start; the other fields were not, so a
   * re-import silently reverted every correction staff had typed into the
   * dashboard — a fixed phone number, a corrected business name — back to
   * whatever Lawmatics still held. That is destroyed work, and it is invisible
   * because the row still looks populated.
   *
   * Filling a BLANK is always allowed and is not affected by this flag: there
   * is no local edit to lose. Only a real disagreement is held back, and held-
   * back changes are reported on the plan so the operator can see what Lawmatics
   * would have written and opt in deliberately.
   */
  overwriteEditedFields: boolean;
  /**
   * Restrict the import to prospects whose `practiceArea` contains this text
   * case-insensitively (blueprint §6 — "strictly leads for intake for
   * Trademarks"). `null` (the default) imports every practice area, matching
   * the importer's behavior before this option existed.
   *
   * A record with NO practice area on it is excluded too when this is set: a
   * strict filter cannot include what it cannot see, and silently importing
   * an unlabeled record would defeat the point of turning the filter on.
   * Both exclusions land in `skipped` with a distinct, human-readable reason
   * rather than disappearing — see the two reason strings in `planImport`.
   */
  practiceAreaFilter: string | null;
};

/**
 * Lawmatics and Lectual disagree about where a matched lead sits, and the
 * operator did NOT opt into stage moves. Reported, never acted on — the whole
 * point of the default is that an attorney's stage change here survives a
 * re-import.
 */
export type StageDivergence = {
  lawmaticsId: string;
  leadId: string;
  matterName: string | null;
  sourceStageName: string | null;
  targetStageName: string | null;
};

/**
 * Lawmatics holds a different non-empty value than Lectual for one or more
 * fields, and the operator did NOT opt into overwriting. Reported, never
 * acted on — the field-level twin of StageDivergence.
 *
 * This has to be its own bucket rather than living only on the update: a
 * record whose ONLY differences are withheld writes nothing, so it lands in
 * `unchanged`, and the disagreement would otherwise disappear from the plan
 * entirely.
 */
export type WithheldFields = {
  lawmaticsId: string;
  leadId: string;
  matterName: string | null;
  changes: FieldChange[];
};

export type ImportPlan = {
  options: PlanOptions;
  creates: PlannedCreate[];
  updates: PlannedUpdate[];
  /** Matched, already current — nothing to write. */
  unchanged: Array<{ lawmaticsId: string; leadId: string; matterName: string | null }>;
  /** Informational: stage disagreements left alone. Not a write. */
  divergences: StageDivergence[];
  /** Informational: field disagreements left alone. Not a write. */
  withheld: WithheldFields[];
  unmapped: UnmappedRecord[];
  skipped: SkippedRecord[];
  totals: {
    sourceRecords: number;
    create: number;
    update: number;
    unchanged: number;
    divergent: number;
    /** Records with at least one field change held back. Not a write. */
    withheld: number;
    unmapped: number;
    skipped: number;
  };
  /**
   * Stable hash of every decision in this plan. The confirm step re-derives the
   * plan from scratch and refuses to write if the fingerprint moved — so an
   * operator can only ever approve the plan they were actually shown.
   */
  fingerprint: string;
};

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  moveExistingStages: false,
  overwriteEditedFields: false,
  practiceAreaFilter: null,
};

const TWO_RECORDS_ONE_LEAD =
  "Another Lawmatics record in this same pull already matches this lead — link the right one in Lectual first, this import won't choose.";

function displayName(rec: LawmaticsSourceRecord): string | null {
  const joined = [rec.firstName, rec.lastName].filter(Boolean).join(" ").trim();
  return joined || rec.matterName || null;
}

function normalizedEmail(value: string | null | undefined): string | null {
  const v = value?.trim().toLowerCase();
  return v ? v : null;
}

/**
 * Comparison key for a person's name — case, punctuation and spacing
 * insensitive, so "O'Brien" / "OBrien" and "Jane  Doe" / "jane doe" match.
 * Null when there is no name to compare.
 */
function nameKey(value: string | null | undefined): string | null {
  const v = value
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return v ? v : null;
}

/** Incoming non-empty value differs from what's stored → a change. */
function diff(
  field: keyof LeadWriteFields,
  current: string | null,
  incoming: string | null,
): FieldChange | null {
  // A blank from Lawmatics never erases a value that's already in Lectual.
  if (incoming === null || incoming === "") return null;
  const from = current ?? null;
  if ((from ?? "") === incoming) return null;
  return { field, from, to: incoming };
}

export function planImport(
  sources: readonly LawmaticsSourceRecord[],
  stages: readonly StageRef[],
  existing: readonly ExistingLead[],
  options: PlanOptions = DEFAULT_PLAN_OPTIONS,
): ImportPlan {
  const creates: PlannedCreate[] = [];
  const updates: PlannedUpdate[] = [];
  const unchanged: ImportPlan["unchanged"] = [];
  const unmapped: UnmappedRecord[] = [];
  const skipped: SkippedRecord[] = [];

  const byLawmaticsId = new Map<string, ExistingLead>();
  const byEmail = new Map<string, ExistingLead[]>();
  for (const lead of existing) {
    if (lead.lawmatics_id) byLawmaticsId.set(lead.lawmatics_id, lead);
    const email = normalizedEmail(lead.email);
    if (email) {
      const bucket = byEmail.get(email);
      if (bucket) bucket.push(lead);
      else byEmail.set(email, [lead]);
    }
  }

  const seenSourceIds = new Set<string>();
  // Two Lawmatics prospects can share one contact/email. The first wins; the
  // second is reported rather than silently merged into it. Without these,
  // two source records could both target one lead row and the later write would
  // quietly overwrite the earlier one's lawmatics_id.
  const claimedEmails = new Set<string>();
  const claimedLeadIds = new Set<string>();

  for (const rec of sources) {
    const name = displayName(rec);
    const base = {
      lawmaticsId: rec.lawmaticsId,
      matterName: rec.matterName,
      name,
      email: rec.email,
    };

    if (!rec.lawmaticsId) {
      skipped.push({ ...base, reason: "The Lawmatics record has no id — it cannot be re-synced safely." });
      continue;
    }
    if (seenSourceIds.has(rec.lawmaticsId)) {
      skipped.push({ ...base, reason: "Duplicate — this Lawmatics id appeared more than once in the response." });
      continue;
    }
    seenSourceIds.add(rec.lawmaticsId);

    if (!rec.email) {
      skipped.push({
        ...base,
        reason: "No usable email address on the Lawmatics record. Add one in Lawmatics and re-run.",
      });
      continue;
    }
    if (!rec.firstName && !rec.lastName) {
      skipped.push({ ...base, reason: "No name on the Lawmatics record." });
      continue;
    }

    // Applied before matching/stage resolution and BEFORE the create/update
    // split, so an already-linked record loses its exemption too — "strictly
    // trademark intake" means every non-matching practice area, not just new
    // ones. A record with no practice area on it is excluded as well: a
    // strict filter can't include what it can't see.
    if (options.practiceAreaFilter) {
      if (rec.practiceArea === null) {
        skipped.push({
          ...base,
          reason: `no practice area on record — excluded by filter "${options.practiceAreaFilter}"`,
        });
        continue;
      }
      if (!rec.practiceArea.toLowerCase().includes(options.practiceAreaFilter.toLowerCase())) {
        skipped.push({
          ...base,
          reason: `practice area "${rec.practiceArea}" excluded by filter "${options.practiceAreaFilter}"`,
        });
        continue;
      }
    }

    // referral_source is only ever stamped when Lawmatics actually named a
    // source — a missing field means "we don't know", not "Inbound", and
    // guessing "Inbound" from silence would misrepresent every record
    // Lawmatics simply doesn't expose this attribute for.
    const referralSource = rec.referralSource !== null
      ? classifyReferralSource(rec.referralSource).source
      : null;

    const fields: LeadWriteFields = {
      first_name: rec.firstName ?? "",
      last_name: rec.lastName ?? "",
      email: rec.email,
      phone: rec.phone,
      business_name: rec.businessName,
      website: rec.website,
      practice_area: rec.practiceArea,
      referral_source: referralSource,
      referral_detail: rec.referralSource,
    };

    const stageResult = resolveStage(rec.stageName, stages);
    const existingByfId = byLawmaticsId.get(rec.lawmaticsId);

    // ── Already linked → update ────────────────────────────────────────────
    if (existingByfId) {
      if (claimedLeadIds.has(existingByfId.id)) {
        skipped.push({ ...base, reason: TWO_RECORDS_ONE_LEAD });
        continue;
      }
      claimedLeadIds.add(existingByfId.id);
      updates.push(
        buildUpdate(existingByfId, rec, fields, stageResult, options, "lawmatics_id", false),
      );
      continue;
    }

    // ── Not linked → try to adopt a local lead with the same email ─────────
    const emailMatches = byEmail.get(rec.email) ?? [];
    if (emailMatches.length > 1) {
      skipped.push({
        ...base,
        reason: `${emailMatches.length} existing leads share this email — link the right one in Lectual first, this import won't guess.`,
      });
      continue;
    }
    const emailMatch = emailMatches[0];
    if (emailMatch && emailMatch.lawmatics_id && emailMatch.lawmatics_id !== rec.lawmaticsId) {
      skipped.push({
        ...base,
        reason: `This email is already linked to a different Lawmatics record (${emailMatch.lawmatics_id}).`,
      });
      continue;
    }
    if (emailMatch) {
      if (claimedLeadIds.has(emailMatch.id)) {
        skipped.push({ ...base, reason: TWO_RECORDS_ONE_LEAD });
        continue;
      }
      // An email address is not an identity. A shared business inbox
      // (info@, hello@) is routine in a trademark practice, and Lectual's
      // leads arrive from self-service Pathset assessments where they are
      // normal. Adopting on email alone let a Lawmatics prospect take over a
      // DIFFERENT person's lead row — keeping that row's id, activity
      // timeline, voice notes and matters, but wearing the incoming name.
      //
      // So adopt only when the two names do not actively contradict each
      // other. A local lead with no name has nothing to contradict, and is
      // still adopted (the import fills it in).
      const localName = nameKey([emailMatch.first_name, emailMatch.last_name].join(" "));
      const incomingName = nameKey([rec.firstName, rec.lastName].join(" "));
      if (localName && incomingName && localName !== incomingName) {
        skipped.push({
          ...base,
          reason:
            `This email belongs to a differently-named lead in Lectual — shared inboxes are common, ` +
            `so this import won't merge two people onto one record. Link the right lead in Lectual first.`,
        });
        continue;
      }
      claimedLeadIds.add(emailMatch.id);
      updates.push(buildUpdate(emailMatch, rec, fields, stageResult, options, "email", true));
      continue;
    }

    // ── Brand new → create, but only with a real stage ─────────────────────
    if (!stageResult.ok) {
      unmapped.push({ ...base, sourceStageName: rec.stageName, reason: stageResult.reason });
      continue;
    }
    if (claimedEmails.has(rec.email)) {
      skipped.push({
        ...base,
        reason: "Another Lawmatics record in this same pull already claims this email address.",
      });
      continue;
    }
    claimedEmails.add(rec.email);

    creates.push({
      lawmaticsId: rec.lawmaticsId,
      matterName: rec.matterName,
      fields,
      stageId: stageResult.stage.id,
      stageName: stageResult.stage.name,
      stageVia: stageResult.via,
      sourceStageName: rec.stageName,
      createdAt: rec.createdAt,
      lastActivityAt: rec.updatedAt,
    });
  }

  // An update with nothing to change is not a write. A stage disagreement the
  // operator didn't opt into is reported separately rather than being turned
  // into one — so a re-run of unchanged data really does write nothing.
  const realUpdates: PlannedUpdate[] = [];
  const divergences: StageDivergence[] = [];
  const withheld: WithheldFields[] = [];
  for (const update of updates) {
    if (update.heldBackChanges.length > 0) {
      withheld.push({
        lawmaticsId: update.lawmaticsId,
        leadId: update.leadId,
        matterName: update.matterName,
        changes: update.heldBackChanges,
      });
    }
    if (update.stageDiverges && !update.stageWillMove) {
      divergences.push({
        lawmaticsId: update.lawmaticsId,
        leadId: update.leadId,
        matterName: update.matterName,
        sourceStageName: update.sourceStageName,
        targetStageName: update.targetStageName,
      });
    }
    if (update.changes.length === 0 && !update.stageWillMove && !update.linksRecord) {
      unchanged.push({
        lawmaticsId: update.lawmaticsId,
        leadId: update.leadId,
        matterName: update.matterName,
      });
    } else {
      realUpdates.push(update);
    }
  }

  const plan: Omit<ImportPlan, "fingerprint"> = {
    options,
    creates,
    updates: realUpdates,
    unchanged,
    divergences,
    withheld,
    unmapped,
    skipped,
    totals: {
      sourceRecords: sources.length,
      create: creates.length,
      update: realUpdates.length,
      unchanged: unchanged.length,
      divergent: divergences.length,
      withheld: withheld.length,
      unmapped: unmapped.length,
      skipped: skipped.length,
    },
  };

  return { ...plan, fingerprint: fingerprintPlan(plan) };
}

function buildUpdate(
  lead: ExistingLead,
  rec: LawmaticsSourceRecord,
  fields: LeadWriteFields,
  stageResult: ReturnType<typeof resolveStage>,
  options: PlanOptions,
  matchedBy: "lawmatics_id" | "email",
  linksRecord: boolean,
): PlannedUpdate {
  // A change that only FILLS A BLANK is always applied — nothing local is
  // lost. A change that would replace an existing non-empty value is held back
  // unless the operator explicitly opted in, because that value may be a
  // correction a human typed into the dashboard.
  const changes: FieldChange[] = [];
  const heldBackChanges: FieldChange[] = [];
  for (const change of [
    diff("first_name", lead.first_name, fields.first_name),
    diff("last_name", lead.last_name, fields.last_name),
    diff("email", lead.email, fields.email),
    diff("phone", lead.phone, fields.phone),
    diff("business_name", lead.business_name, fields.business_name),
    diff("website", lead.website, fields.website),
    diff("practice_area", lead.practice_area, fields.practice_area),
    diff("referral_source", lead.referral_source, fields.referral_source),
    diff("referral_detail", lead.referral_detail, fields.referral_detail),
  ]) {
    if (!change) continue;
    const overwritesLocalValue = (change.from ?? "") !== "";
    if (overwritesLocalValue && !options.overwriteEditedFields) heldBackChanges.push(change);
    else changes.push(change);
  }

  const targetStageId = stageResult.ok ? stageResult.stage.id : null;
  const targetStageName = stageResult.ok ? stageResult.stage.name : null;
  const stageDiverges = targetStageId !== null && targetStageId !== lead.current_stage_id;

  return {
    lawmaticsId: rec.lawmaticsId,
    leadId: lead.id,
    matterName: rec.matterName,
    matchedBy,
    linksRecord,
    changes,
    heldBackChanges,
    sourceStageName: rec.stageName,
    targetStageId,
    targetStageName,
    stageDiverges,
    stageWillMove: stageDiverges && options.moveExistingStages,
    stageNote: stageResult.ok ? null : stageResult.reason,
  };
}

/**
 * Fingerprint every decision the operator is shown. Order-independent (the
 * per-record lines are sorted) so an unstable API ordering doesn't invalidate
 * an otherwise identical plan, but value-sensitive: any changed field, stage,
 * or bucket produces a different hash and forces a fresh preview.
 */
export function fingerprintPlan(plan: Omit<ImportPlan, "fingerprint">): string {
  const lines: string[] = [
    `opts:moveExistingStages=${plan.options.moveExistingStages}`,
    `opts:overwriteEditedFields=${plan.options.overwriteEditedFields}`,
    `opts:practiceAreaFilter=${plan.options.practiceAreaFilter ?? ""}`,
  ];
  for (const c of plan.creates) {
    lines.push(
      `create|${c.lawmaticsId}|${c.stageId}|${JSON.stringify(c.fields)}`,
    );
  }
  for (const u of plan.updates) {
    lines.push(
      // heldBackChanges is part of what the operator is SHOWN, so it belongs in
      // the hash: flipping overwriteEditedFields moves a change between the two
      // buckets and must invalidate a previously-approved plan.
      `update|${u.lawmaticsId}|${u.leadId}|${u.linksRecord}|${u.stageWillMove ? u.targetStageId : ""}|${JSON.stringify(u.changes)}|held:${JSON.stringify(u.heldBackChanges)}`,
    );
  }
  for (const d of plan.divergences) {
    lines.push(`diverge|${d.lawmaticsId}|${d.sourceStageName ?? ""}|${d.targetStageName ?? ""}`);
  }
  for (const w of plan.withheld) {
    lines.push(`withheld|${w.lawmaticsId}|${JSON.stringify(w.changes)}`);
  }
  for (const u of plan.unmapped) lines.push(`unmapped|${u.lawmaticsId}|${u.sourceStageName ?? ""}`);
  for (const s of plan.skipped) lines.push(`skipped|${s.lawmaticsId}|${s.reason}`);
  for (const u of plan.unchanged) lines.push(`unchanged|${u.lawmaticsId}`);
  lines.sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
}
