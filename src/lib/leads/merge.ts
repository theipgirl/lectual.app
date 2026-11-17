import type { Role } from "@/lib/auth/roles";
import { LEAD_MERGED_WRITE, MERGE_FAILED, MERGE_REFUSALS, notReadyYet } from "@/lib/ui/words";

/**
 * Merge duplicate leads (M5, lectual 0107). PURE rules plus one runner with its dependencies injected, so the
 * gates and the refusal sentences are tested without a database. The action (src/app/dashboard/intake/merge/
 * actions.ts) wires the scoped client; the database function `crm_merge_leads` does the merge and is the real
 * boundary (it re-checks the session, the role and the org).
 */

/** Who may merge. lectual 0107's function allows exactly these; anyone else is refused before any read. */
export const MERGE_ROLES: readonly Role[] = ["owner", "admin", "senior_admin"];

export function canMergeLeads(role: Role | null | undefined): boolean {
  return !!role && MERGE_ROLES.includes(role);
}

/** The fields a person may choose per merge, in the order the screen shows them. The function takes no others. */
export const MERGE_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "phone",
  "business_name",
  "website",
  "mark_text",
  "referral_source",
  "referral_detail",
  "practice_area",
  "assigned_to",
  "temperature",
  "lane",
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];
export type MergeSide = "keeper" | "loser";
export type MergeChoices = Partial<Record<MergeField, MergeSide>>;

const isMergeField = (v: string): v is MergeField => (MERGE_FIELDS as readonly string[]).includes(v);

/** The form field name of one choice. */
export const choiceName = (field: MergeField) => `choice.${field}`;

/**
 * The `p_choices` object, built ONLY from known fields and the two known sides. Anything else the browser posts
 * (an unknown field, another value, a field posted twice with different values) is left out, so the database
 * falls back to its own rule for that field (keep the keeper's value unless it is empty).
 */
export function buildChoices(form: { getAll: (name: string) => unknown[] } | Iterable<[string, unknown]>): MergeChoices {
  const out: MergeChoices = {};
  const read = (name: string): unknown[] => {
    if ("getAll" in form && typeof form.getAll === "function") return form.getAll(name);
    const all: unknown[] = [];
    for (const [k, v] of form as Iterable<[string, unknown]>) if (k === name) all.push(v);
    return all;
  };
  for (const field of MERGE_FIELDS) {
    const values = read(choiceName(field));
    if (values.length === 0) continue;
    const distinct = new Set(values);
    if (distinct.size !== 1) continue;
    const value = values[0];
    if (value === "keeper" || value === "loser") out[field] = value;
  }
  return out;
}

/** Pure: the default per field, the same rule the database uses for a field that isn't named. */
export function defaultChoice(keeperValue: unknown, loserValue: unknown): MergeSide {
  return isEmptyValue(keeperValue) && !isEmptyValue(loserValue) ? "loser" : "keeper";
}

export function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/** Pure: whether two values read as the same for the screen (case and surrounding space ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  return String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
}

export type KeeperFacts = { id: string; createdAt: string | null; hasMatter: boolean; hasLawmatics: boolean };
export type KeeperWhy = "matter" | "lawmatics" | "older" | "chosen";

/**
 * Pure: which lead to keep when nobody has chosen. The one with a matter; else the one linked to Lawmatics;
 * else the older; a tie keeps `a`. Says why, so the screen can explain the suggestion.
 */
export function suggestKeeper(a: KeeperFacts, b: KeeperFacts): { keeperId: string; why: KeeperWhy } {
  if (a.hasMatter !== b.hasMatter) return { keeperId: a.hasMatter ? a.id : b.id, why: "matter" };
  if (a.hasLawmatics !== b.hasLawmatics) return { keeperId: a.hasLawmatics ? a.id : b.id, why: "lawmatics" };
  const at = Date.parse(a.createdAt ?? "");
  const bt = Date.parse(b.createdAt ?? "");
  if (Number.isFinite(at) && Number.isFinite(bt) && bt < at) return { keeperId: b.id, why: "older" };
  return { keeperId: a.id, why: "older" };
}

const PREFIXES = Object.keys(MERGE_REFUSALS) as (keyof typeof MERGE_REFUSALS)[];

const messageOf = (err: unknown) => {
  const m = (err as { message?: unknown } | null | undefined)?.message;
  return typeof m === "string" ? m : "";
};
const codeOf = (err: unknown) => {
  const c = (err as { code?: unknown } | null | undefined)?.code;
  return typeof c === "string" ? c : "";
};

/** True for lectual 0107's guard on a merged lead (42501, message prefixed `lead_merge_guarded`). */
export function isLeadMergeGuarded(err: unknown): boolean {
  return codeOf(err) === "42501" && messageOf(err).trimStart().startsWith("lead_merge_guarded");
}

/** The fixed sentence for a write that reached a merged lead, else null. */
export function mergeGuardSentence(err: unknown): string | null {
  return isLeadMergeGuarded(err) ? LEAD_MERGED_WRITE : null;
}

/**
 * Maps a crm_merge_leads failure to a fixed sentence by its message PREFIX (never echoing the message). A
 * function that isn't there (42883 / PGRST202: lectual 0107 not applied) is the "isn't switched on" sentence.
 * Anything else is the generic sentence.
 */
export function mergeErrorSentence(err: unknown): string {
  const message = messageOf(err).trimStart();
  for (const prefix of PREFIXES) if (message.startsWith(prefix)) return MERGE_REFUSALS[prefix];
  if (isLeadMergeGuarded(err)) return LEAD_MERGED_WRITE;
  const code = codeOf(err);
  if (code === "42883" || code === "PGRST202") return notReadyYet("Merging leads");
  return MERGE_FAILED;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isLeadId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export type MergeInput = { keeperId: unknown; loserId: unknown; choices: MergeChoices };
export type MergeResult = { ok: true; keeperId: string; counts: Record<string, number> } | { ok: false; error: string };

export type MergeDeps = {
  /** Resolves the caller's role on THIS call (throws when there is none). */
  role: () => Promise<Role>;
  /** Calls crm_merge_leads through the caller's scoped client. */
  merge: (args: { p_keeper: string; p_loser: string; p_choices: MergeChoices }) => Promise<{ data: unknown; error: unknown }>;
};

/** Pure: the counts the function returned, kept only when they are whole numbers. */
export function readCounts(data: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!data || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) if (typeof v === "number" && Number.isInteger(v) && v >= 0) out[k] = v;
  return out;
}

/**
 * The merge. The role is resolved FIRST and a refused role reads and writes nothing. Then the ids are checked
 * (two different lead ids) and the database function is called once. Every failure is a fixed sentence.
 */
export async function runMergeLeads(input: MergeInput, deps: MergeDeps): Promise<MergeResult> {
  let role: Role;
  try {
    role = await deps.role();
  } catch {
    return { ok: false, error: MERGE_REFUSALS.merge_not_allowed };
  }
  if (!canMergeLeads(role)) return { ok: false, error: MERGE_REFUSALS.merge_not_allowed };
  if (!isLeadId(input.keeperId) || !isLeadId(input.loserId)) return { ok: false, error: MERGE_REFUSALS.merge_not_found };
  if (input.keeperId.toLowerCase() === input.loserId.toLowerCase()) return { ok: false, error: MERGE_REFUSALS.merge_same_record };
  const choices: MergeChoices = {};
  for (const [field, side] of Object.entries(input.choices ?? {})) {
    if (isMergeField(field) && (side === "keeper" || side === "loser")) choices[field] = side;
  }
  try {
    const { data, error } = await deps.merge({ p_keeper: input.keeperId, p_loser: input.loserId, p_choices: choices });
    if (error) return { ok: false, error: mergeErrorSentence(error) };
    return { ok: true, keeperId: input.keeperId, counts: readCounts(data) };
  } catch (err) {
    return { ok: false, error: mergeErrorSentence(err) };
  }
}
