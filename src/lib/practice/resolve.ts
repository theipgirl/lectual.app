/**
 * Practice resolution — pure, no database, no `server-only`, safe to import
 * from a `"use client"` component.
 *
 * Tracy runs two unrelated practices out of one tenant, and the schema has no
 * column that says which is which. It does not need one: her docket already
 * encodes the answer in the stage ladder a matter sits on.
 *
 *   LIT + stage code starting "PC"           -> collections
 *   LIT + (LIT-ladder code | stage_id null)  -> litigation
 *   TM                                       -> trademark
 *
 * The load-bearing case is the third form of the second line. 22 of her 34
 * live litigation matters carry `stage_id IS NULL` — deliberately unplaced,
 * awaiting her judgment. A resolver that required a stage to name a practice
 * would drop 65% of her live caseload out of every tab. So an unplaced LIT
 * matter resolves to `litigation`, and that is asserted by its own test.
 *
 * Everything here fails toward *showing* a matter. There is no "unknown"
 * practice and no null return: an unrecognised stage code on a LIT matter is
 * litigation (the ladder it is nominally on), and a type this firm does not
 * otherwise use lands in a real tab rather than nowhere.
 */

/** The matter type enum as it exists in `crm_matter.type`. */
export type MatterType = "TM" | "PATENT" | "CR" | "BL" | "EL" | "SO" | "LIT";

export type PracticeId = "litigation" | "collections" | "trademark";

export type PracticeDefinition = {
  id: PracticeId;
  label: string;
  /** Tab order, ascending. Contiguous, but only the relative order matters. */
  order: number;
};

/**
 * The tab registry. Tabs are rendered by mapping this array, so adding or
 * reordering a practice is a one-line data change and no practice is
 * hardcoded as the primary one.
 */
export const PRACTICES: readonly PracticeDefinition[] = [
  { id: "litigation", label: "Litigation", order: 1 },
  { id: "collections", label: "Collections", order: 2 },
  { id: "trademark", label: "Trademark", order: 3 },
] as const;

/** The registry in tab order. Pure — never mutates PRACTICES. */
export function practicesInOrder(): PracticeDefinition[] {
  return [...PRACTICES].sort((a, b) => a.order - b.order);
}

export function practiceLabel(id: PracticeId): string {
  return PRACTICES.find((p) => p.id === id)?.label ?? id;
}

/**
 * Collections stages are the payroll/pre-collection ladder: PC10 Document
 * Review, PC20 File Summons, PC30 File Complaint, PC40 Pursuing Related,
 * PC80 Not Pursuing, PC90 Complete. The prefix — not an enumeration of the
 * six codes — is the test, so a seventh PC stage added to her docket
 * tomorrow lands in the right tab without a code change here.
 */
export const COLLECTIONS_STAGE_PREFIX = "PC";

/**
 * The litigation ladder, for documentation and for the stage-order UI. It is
 * deliberately NOT the gate for resolving to `litigation`: a LIT matter on a
 * stage that is not in this list still resolves to litigation, because the
 * alternative is a matter with nowhere to appear.
 */
export const LITIGATION_STAGE_CODES: readonly string[] = [
  "SERVED",
  "ANSWER",
  "MOT_PENDING",
  "HEARING_SET",
  "DISCOVERY",
  "TRIAL_SET",
  "JUDGMENT",
  "POST_JUDGMENT",
  "CLOSED",
] as const;

/** True for a stage code on the collections ladder. Case-insensitive. */
export function isCollectionsStageCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return code.trim().toUpperCase().startsWith(COLLECTIONS_STAGE_PREFIX);
}

/** True for a stage code on the litigation ladder proper. Case-insensitive. */
export function isLitigationStageCode(code: string | null | undefined): boolean {
  if (!code) return false;
  return LITIGATION_STAGE_CODES.includes(code.trim().toUpperCase());
}

/** The little of a matter this resolver reads. */
export type PracticeMatter = {
  type: MatterType;
  /** Null for the 22 unplaced matters. Never a reason to drop the matter. */
  stage_id?: string | null;
};

/** The little of a stage this resolver reads. */
export type PracticeStage = {
  code: string;
};

/**
 * Which practice tab a matter belongs to.
 *
 * `stage` is passed separately rather than read off the matter because the
 * caller may not be able to see the stage row at all (RLS, or a stage catalog
 * fetched for a different window). A missing stage is never an error: it just
 * means the type-level answer stands.
 */
export function resolvePractice(
  matter: PracticeMatter,
  stage?: PracticeStage | null,
): PracticeId {
  if (matter.type === "LIT") {
    // A stage we cannot see, or no stage at all, is litigation. This is the
    // 22-matter defense, in one branch.
    if (isCollectionsStageCode(stage?.code)) return "collections";
    return "litigation";
  }
  // TM is trademark by definition; PATENT is the same prosecution-side desk
  // and shares the tab rather than being stranded without one.
  if (matter.type === "TM" || matter.type === "PATENT") return "trademark";
  // CR / BL / EL / SO are not part of Tracy's docket today. Should one appear,
  // it surfaces on the litigation board rather than vanishing.
  return "litigation";
}

/** Pure — groups matters by practice, preserving input order within a tab. */
export function groupByPractice<M extends PracticeMatter>(
  matters: M[],
  stageFor: (matter: M) => PracticeStage | null | undefined,
): Record<PracticeId, M[]> {
  const grouped: Record<PracticeId, M[]> = {
    litigation: [],
    collections: [],
    trademark: [],
  };
  for (const matter of matters) {
    grouped[resolvePractice(matter, stageFor(matter))].push(matter);
  }
  return grouped;
}
