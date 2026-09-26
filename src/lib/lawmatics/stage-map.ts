/**
 * Lawmatics stage name → the tenant's own `crm_stage` row, BY NAME.
 *
 * DESIGN RULE: never guess. A record whose Lawmatics stage cannot be resolved
 * to one of the firm's real stages is reported in the "unmapped" bucket and
 * NOT imported — it is not parked in the first stage, not dropped, and not
 * approximated. A wrong stage is worse than a missing row: it tells an attorney
 * a matter is somewhere it isn't.
 *
 * Resolution order:
 *   1. Normalized exact match against the tenant's stage names.
 *   2. The alias table below — ordered candidate names per Lawmatics stage;
 *      the first candidate the tenant actually has wins. Aliases encode
 *      *identity* ("these two names are the same pipeline position"), never
 *      judgement ("this is probably close enough").
 *   3. Unmapped.
 *
 * Ordered candidates are what lets one table serve two very different
 * pipelines: RPB Law's 21 SOP stages (0028) and the 7-stage default every new
 * org is seeded with (0017).
 *
 * Pure module: no I/O. Unit-tested.
 */

/**
 * Case/punctuation-insensitive key for a stage name.
 * "Follow-Up" / "follow up" / "FOLLOW UP" all collapse to "follow up";
 * "LOE & Invoice Sent" and "LOE and Invoice Sent" both to "loe and invoice sent".
 * A leading list number ("3. Preliminary Search") is dropped — Lawmatics users
 * often number stages to force UI ordering.
 */
export function normalizeStageName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^\s*\d+\s*[.)\-:]\s*/, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Known Lawmatics stage names → candidate Lectual stage names, best first.
 *
 * Every entry is a documented equivalence. Deliberately ABSENT (and therefore
 * reported as unmapped, for a human to decide):
 *   • "Discovery Call No Show"          — SOP may route this to Follow-Up or to
 *                                         Lost; that's a firm policy call.
 *   • "Discovery Call Complete"         — "complete" is not the same position as
 *   • "Legal Strategy Session Complete"   "Post Consultation Email Sent".
 *   • "Hired Client" / "Hired"          — see below. This one is load-bearing.
 *   • Anything not listed at all.
 *
 * WHY "Hired Client" IS NOT ALIASED (removed 2026-08; do not re-add without
 * reading this). It previously mapped to "Signed LOE / Deposit Received", on
 * the reasoning that RPB's SOP defines the PNC→Hired conversion as exactly
 * signed LOE + deposit. That reasoning is correct about the CONVERSION and
 * wrong about the STAGE, because the two pipelines are different shapes:
 *
 *   Lawmatics' RPB pipeline is an ELEVEN-stage INTAKE pipeline that ENDS at
 *   "Hired Client". Lectual's RPB pipeline is TWENTY-ONE stages covering the
 *   whole lifecycle. Every position after engagement — Comprehensive Search,
 *   Preparing Opinion Letter, Application Filed, Awaiting Trademark
 *   Registration, Publication for Opposition — has no Lawmatics equivalent,
 *   so all of it sits upstream as "Hired Client".
 *
 * Aliasing it therefore collapsed the firm's entire post-engagement book onto
 * one stage: a matter filed eight months ago and awaiting registration would
 * import as a client who had just paid their deposit — and, because
 * `stage_entered_at` defaults to now(), with its aging clock reset too. For a
 * firm with a live book that is most of the active matters, and a re-run does
 * not repair it.
 *
 * Unmapped is the honest answer: "Hired Client" genuinely does not say where
 * in the lifecycle a matter has got to, and this module's first rule is never
 * to guess. The cost is that a default-pipeline tenant (which has a catch-all
 * "Active Matter") now also gets these as unmapped rather than auto-placed;
 * that is accepted, because the table is shared and a wrong stage on a real
 * docket is worse than a human placing a row.
 */
const ALIASES: Record<string, readonly string[]> = {
  // ── Intake ────────────────────────────────────────────────────────────────
  // PNC is RPB's abbreviation for Potential New Client — a literal expansion.
  "new pnc": ["New PNC", "Potential New Client", "New Inquiry"],
  pnc: ["New PNC", "Potential New Client", "New Inquiry"],
  "potential new client": ["Potential New Client", "New PNC", "New Inquiry"],
  "new lead": ["Potential New Client", "New PNC", "New Inquiry"],
  "new inquiry": ["New Inquiry", "Potential New Client", "New PNC"],

  // ── Consultations (same calendar event, different label per pipeline) ─────
  "discovery call scheduled": ["Discovery Call", "Consultation Scheduled"],
  "discovery call": ["Discovery Call", "Consultation Scheduled"],
  "consultation scheduled": ["Consultation Scheduled", "Discovery Call"],
  "legal strategy session scheduled": ["Strategy Session", "Consultation Scheduled"],
  "strategy session scheduled": ["Strategy Session", "Consultation Scheduled"],
  "strategy session": ["Strategy Session", "Consultation Scheduled"],

  // ── Engagement ────────────────────────────────────────────────────────────
  // "Pending LOE + Payment" and "LOE & Invoice Sent" describe the same state:
  // the engagement letter is out, signature and money are outstanding.
  // "Pending LOE + Payment" normalizes to "pending loe payment" (the `+` is
  // punctuation); the "and" spelling is keyed too for "Pending LOE & Payment".
  "pending loe payment": ["Pending LOE + Payment", "LOE & Invoice Sent", "Engagement Letter"],
  "pending loe and payment": ["Pending LOE + Payment", "LOE & Invoice Sent", "Engagement Letter"],
  "loe and invoice sent": ["LOE & Invoice Sent", "Pending LOE + Payment", "Engagement Letter"],
  "engagement letter sent": ["LOE & Invoice Sent", "Pending LOE + Payment", "Engagement Letter"],
  // NOTE: "Hired Client" / "Hired" are deliberately NOT aliased — see the
  // "Deliberately ABSENT" note in this module's header for why. They resolve
  // to unmapped so a human places each engaged matter.
  //
  // This key stays: it fires only when a firm's Lawmatics pipeline literally
  // names a stage "Signed LOE / Deposit Received", which is a true identity
  // rather than an inference about where an engaged matter has got to.
  "signed loe deposit received": ["Signed LOE / Deposit Received", "Hired Client", "Active Matter"],

  // ── Holding / exit ────────────────────────────────────────────────────────
  undecided: ["Undecided / Questions", "Undecided"],
  "undecided questions": ["Undecided / Questions", "Undecided"],
  "follow up": ["Follow-Up", "Follow Up"],
  "lost lead": ["Lost", "Lost Lead"],
  lost: ["Lost", "Lost Lead"],
  nurture: ["Nurture"],
};

/** One of the tenant's own stage rows — only the fields the mapper needs. */
export type StageRef = { id: string; name: string };

export type StageResolution =
  | { ok: true; stage: StageRef; via: "exact" | "alias" }
  | { ok: false; reason: string };

/**
 * Resolve a Lawmatics stage name against the tenant's stages.
 * `stages` must be the caller's own org rows (RLS-scoped) — this function has
 * no notion of tenancy and will happily match whatever it is handed.
 */
export function resolveStage(
  lawmaticsStage: string | null,
  stages: readonly StageRef[],
): StageResolution {
  if (!lawmaticsStage || !lawmaticsStage.trim()) {
    return {
      ok: false,
      reason: "The Lawmatics record has no stage — nothing to map it onto.",
    };
  }

  const byNormalizedName = new Map<string, StageRef>();
  for (const stage of stages) {
    const key = normalizeStageName(stage.name);
    // First writer wins, so a duplicate-named stage can't shadow the earlier one.
    if (!byNormalizedName.has(key)) byNormalizedName.set(key, stage);
  }

  const key = normalizeStageName(lawmaticsStage);
  const exact = byNormalizedName.get(key);
  if (exact) return { ok: true, stage: exact, via: "exact" };

  for (const candidate of ALIASES[key] ?? []) {
    const hit = byNormalizedName.get(normalizeStageName(candidate));
    if (hit) return { ok: true, stage: hit, via: "alias" };
  }

  return {
    ok: false,
    reason: `Lawmatics stage "${lawmaticsStage}" doesn't match any of this firm's pipeline stages.`,
  };
}

/**
 * The alias table rendered for docs/UI: Lawmatics name → candidate Lectual
 * names in preference order. Exposed so the import screen can show a human
 * exactly what the mapping does before they run anything.
 */
export function aliasTable(): Array<{ lawmatics: string; candidates: readonly string[] }> {
  return Object.entries(ALIASES).map(([lawmatics, candidates]) => ({ lawmatics, candidates }));
}
