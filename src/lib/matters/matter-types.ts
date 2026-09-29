import type { Database } from "@/lib/db/types";

/**
 * The `crm_matter_type` vocabulary, as one exhaustive object.
 *
 * PURE MODULE — no `server-only`, no DB client, no `next/*`. That is load
 * bearing twice over: a client component (the "New matter" form) imports it
 * directly, and so does `matters/[id]/actions.ts`, which is a `"use server"`
 * file and therefore cannot itself export a non-async const (the same rule
 * that moved MATTER_WRITE_ROLES into matters.ts and the settings enums into
 * src/lib/settings/enums.ts). Both sides now read one list instead of two
 * hand-maintained copies that drifted — which is exactly how 'LIT' came to
 * exist in the database, and in the enum generated from it, while being
 * unofferable in the UI and rejected by the create action.
 *
 * ── WHY THE Record IS EXHAUSTIVE ─────────────────────────────────────────────
 * `src/lib/db/types.ts` is GENERATED from the database, so `crm_matter_type`
 * is whatever Postgres says it is. Typing this as a full
 * `Record<crm_matter_type, string>` makes the next `alter type ... add value`
 * fail `pnpm build` until somebody decides what the new type is CALLED to a
 * firm. That compile-time failure is the point of this file. Do not weaken it
 * to `Partial<...>` or `Record<string, string>` — a silently unlabelled matter
 * type is how this bug happened the first time.
 *
 * Labels here are the ones the create form has always shown (parenthesised
 * code where the firm says the code out loud). `MATTER_TYPE_LABEL` in
 * src/app/(firm)/dashboard/matters/_components/labels.ts is the shorter badge
 * wording for the same enum and is deliberately left alone: a chip in a table
 * row has no space for "Entertainment law (EL)".
 */
export type MatterType = Database["public"]["Enums"]["crm_matter_type"];

/**
 * Insertion order IS display order — MATTER_TYPE_VALUES below is derived from
 * this object's keys, so the dropdown can never list a type this map has no
 * label for.
 */
export const MATTER_TYPE_LABELS: Record<MatterType, string> = {
  TM: "Trademark (TM)",
  PATENT: "Patent",
  CR: "Copyright (CR)",
  BL: "Business law (BL)",
  EL: "Entertainment law (EL)",
  SO: "Signature offer (SO)",
  // 0040's litigation-module type. Offered only to a firm holding the
  // 'litigation' module — see NewMatterForm and createMatterAction.
  LIT: "Litigation",
};

/** Every matter type, in display order. Derived — never hand-listed. */
export const MATTER_TYPE_VALUES = Object.keys(MATTER_TYPE_LABELS) as MatterType[];

/** `{ value, label }` pairs for a `<select>`, in the same display order. */
export const MATTER_TYPE_OPTIONS: ReadonlyArray<{ value: MatterType; label: string }> =
  MATTER_TYPE_VALUES.map((value) => ({ value, label: MATTER_TYPE_LABELS[value] }));

/**
 * Runtime guard for a value off a form. Derived from the same object as the
 * labels, so the set the server accepts and the set the form offers are the
 * same set by construction.
 */
export function isMatterType(value: unknown): value is MatterType {
  return typeof value === "string" && (MATTER_TYPE_VALUES as string[]).includes(value);
}

/**
 * Types that require the caller's org to hold a module before a matter of that
 * type may be created. Today: LIT, gated on 'litigation' (0040's
 * crm_require_litigation_module trigger is the same rule one layer down).
 *
 * Kept here, next to the vocabulary, so adding a gated type is one edit rather
 * than a grep. The MODULE CHECK ITSELF is never done here — this module is
 * pure and reaches nothing; the action does it.
 */
export const MATTER_TYPE_MODULE: Partial<Record<MatterType, "litigation">> = {
  LIT: "litigation",
};

/**
 * True when this type's matter_number must be typed by hand.
 *
 * Litigation only. Cabanis Law's convention is that `matter_number` IS the
 * court case number (e.g. `26-CC-011354`) — the 35 matters already in
 * production are numbered that way, and they are looked up by it. createMatter
 * would otherwise auto-assign `LIT-2026-0001`, which is not a case number, is
 * not searchable against the court's docket, and cannot be corrected without
 * touching the row directly.
 */
export function requiresExplicitMatterNumber(type: MatterType): boolean {
  return type === "LIT";
}
