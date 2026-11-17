/**
 * Which Matters-page group a matter belongs to. PURE: no database, no clock, safe in a client bundle.
 *
 * The rule reads the docket stage's `phase` (crm_matter_stage.phase) and the matter's TYPE. It never reads a
 * stage's name, code or label, because firms name stages their own way.
 *
 *   TM, CR, PATENT   phase pipeline                    -> Intake
 *                    phase pre_filing                  -> Pre-filing
 *                    phase post_filing or maintenance  -> Post-filing
 *   everything else  (BL, EL, SO, LIT, any other type)
 *   and any matter   with no stage, or a stage whose phase is null or not one of the four above
 *                                                      -> Matters (contracts and one-offs)
 *
 * So every matter lands in exactly one group and nothing disappears. Pipeline is NOT folded into Pre-filing.
 */

export const PHASE_GROUPS = ["intake", "pre", "post", "other"] as const;
export type PhaseGroup = (typeof PHASE_GROUPS)[number];

/** The matter types that are filed at an office and so move through the phases. */
export const FILING_TYPES: readonly string[] = ["TM", "CR", "PATENT"];

/** The phases a stage can carry. Anything else (including null) means "no phase". */
export const KNOWN_PHASES: readonly string[] = ["pipeline", "pre_filing", "post_filing", "maintenance"];

/** Preferred when the URL names no group. Pre-filing is the working set the firm walks through daily. */
export const DEFAULT_PHASE_GROUP: PhaseGroup = "pre";

type StageLike = { phase?: string | null } | null | undefined;
export type PhaseMatter = { type: string; stage: StageLike };

/** The "All" choice: every matter, whatever its phase. Reached by `?group=all`; the links from Today and Pipeline carry it. */
export const ALL_GROUPS = "all" as const;
export type GroupChoice = PhaseGroup | typeof ALL_GROUPS;

/** `?group=` -> a choice, or null for a missing / unknown value (the page then uses its default). */
export function parseGroupChoice(value: unknown): GroupChoice | null {
  if (value === ALL_GROUPS) return ALL_GROUPS;
  return isPhaseGroup(value) ? value : null;
}

/**
 * The group shown when the URL names none. Pre-filing, but ONLY when it holds at least one matter for the status filter
 * in force (`counts` are the group counts under that filter); otherwise All, so a firm whose TM work is all post-filing
 * (or all contracts) never opens on an empty tab. An explicit `?group=` never reaches this: the caller uses
 * `parseGroupChoice(raw) ?? defaultGroupChoice(counts)`, so a named group wins even when it is empty.
 */
export function defaultGroupChoice(counts: Readonly<Record<PhaseGroup, number>>): GroupChoice {
  return counts[DEFAULT_PHASE_GROUP] > 0 ? DEFAULT_PHASE_GROUP : ALL_GROUPS;
}

/** Matters the chosen group shows: all of them for "All", else exactly the group's. */
export function filterByGroupChoice<T extends PhaseMatter>(matters: readonly T[], choice: GroupChoice): T[] {
  return choice === ALL_GROUPS ? [...matters] : filterByPhaseGroup(matters, choice);
}

export function isPhaseGroup(value: unknown): value is PhaseGroup {
  return typeof value === "string" && (PHASE_GROUPS as readonly string[]).includes(value);
}

function groupOfPhase(phase: string | null | undefined): PhaseGroup | null {
  switch (phase) {
    case "pipeline":
      return "intake";
    case "pre_filing":
      return "pre";
    case "post_filing":
    case "maintenance":
      return "post";
    default:
      return null;
  }
}

export function phaseGroupOf(matter: PhaseMatter): PhaseGroup {
  if (!FILING_TYPES.includes(matter.type)) return "other";
  return groupOfPhase(matter.stage?.phase) ?? "other";
}

/** True when at least one stage carries a phase the rule knows. A firm with none sees the page as it was. */
export function firmHasPhases(stages: ReadonlyArray<{ phase?: string | null }>): boolean {
  return stages.some((s) => typeof s.phase === "string" && KNOWN_PHASES.includes(s.phase));
}

export function filterByPhaseGroup<T extends PhaseMatter>(matters: readonly T[], group: PhaseGroup): T[] {
  return matters.filter((m) => phaseGroupOf(m) === group);
}

export function phaseGroupCounts(matters: readonly PhaseMatter[]): Record<PhaseGroup, number> {
  const out: Record<PhaseGroup, number> = { intake: 0, pre: 0, post: 0, other: 0 };
  for (const m of matters) out[phaseGroupOf(m)] += 1;
  return out;
}

/**
 * The stages one group's board may draw. A phase group draws only the stages of its phase(s); the Matters group
 * draws the stages with no known phase (the ones its matters can sit on). Pure over `{ phase }`.
 */
export function stagesForGroup<T extends { phase?: string | null }>(stages: readonly T[], group: PhaseGroup): T[] {
  return stages.filter((s) => (groupOfPhase(s.phase) ?? "other") === group);
}

/**
 * The stages a group's board draws: the group's own stages, plus any stage that actually holds one of the group's
 * matters (a contract matter filed on a docket stage still shows on that stage, never as "not on the docket").
 */
export function boardStagesForChoice<T extends { id: string; phase?: string | null }>(
  stages: readonly T[],
  choice: GroupChoice,
  matters: ReadonlyArray<{ stage_id: string | null }>,
): T[] {
  return choice === ALL_GROUPS ? [...stages] : boardStagesForGroup(stages, choice, matters);
}

export function boardStagesForGroup<T extends { id: string; phase?: string | null }>(
  stages: readonly T[],
  group: PhaseGroup,
  matters: ReadonlyArray<{ stage_id: string | null }>,
): T[] {
  const held = new Set(matters.map((m) => m.stage_id).filter((id): id is string => !!id));
  return stages.filter((s) => (groupOfPhase(s.phase) ?? "other") === group || held.has(s.id));
}

/** Postgres undefined_column (42703) or PostgREST's schema-cache miss (PGRST204): judged by CODE, never by message text. */
export function isMissingColumnError(error: { code?: string | null } | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}
