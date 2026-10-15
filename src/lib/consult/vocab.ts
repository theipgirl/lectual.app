/**
 * The vocabulary of consult details: the values, labels and stored shape. Kept
 * free of zod and of every server import so client components can use it
 * without pulling the validation code into the browser bundle. The rules live
 * in ./details.ts, which re-exports all of this.
 */

import { FILING_BASIS_LABEL } from "@/lib/matters/ip-fields";

/* ───────────────────────────── vocabulary ───────────────────────────────── */

export const MARK_TYPES = ["word", "design", "unknown"] as const;
export type MarkType = (typeof MARK_TYPES)[number];

/** Lower-case, like crm_filing_basis: "1a" / "1b". `unknown` is not a database value. */
export const CONSULT_BASES = ["1a", "1b", "unknown"] as const;
export type ConsultBasis = (typeof CONSULT_BASES)[number];

export const MARK_TYPE_LABEL: Record<MarkType, string> = {
  word: "Word mark",
  design: "Design mark",
  unknown: "Not stated",
};

export const CONSULT_BASIS_LABEL: Record<ConsultBasis, string> = {
  "1a": FILING_BASIS_LABEL["1a"],
  "1b": FILING_BASIS_LABEL["1b"],
  unknown: "Unknown — not stated",
};

export const MAX_MARKS = 10;
export const MAX_MARK_TEXT = 200;
export const MAX_GOODS_TEXT = 500;
export const MAX_EVIDENCE_TEXT = 400;
export const MAX_FREE_TEXT = 200;

export type ExtractionSource = "post-consult-agent" | "meeting-follow-up" | "manual";

/* ─────────────────────────────── stored shape ───────────────────────────── */

export type ConsultClass = { class: number | null; goods: string };

export type ConsultMark = {
  /** Stable within one record ("m1", "m2"…), so a review edits a mark rather than replacing it. */
  id: string;
  mark: string;
  mark_type: MarkType;
  classes: ConsultClass[];
  /** The value staff reviewed (or, before review, the model's proposal). */
  filing_basis: ConsultBasis;
  /** What the model read. Kept after review so a correction is visible. Null: added by staff. */
  extracted_basis: ConsultBasis | null;
  basis_evidence: string | null;
  first_use_date: string | null;
};

export type ConsultReview = {
  reviewed_at: string;
  reviewed_by: string | null;
  reviewed_by_name: string | null;
  reviewed_by_role: string | null;
};

export type StoredConsultDetails = {
  version: 1;
  /** Bumped by every review; a stale form is refused rather than overwriting. */
  rev: number;
  marks: ConsultMark[];
  recommended_package: string | null;
  discount_discussed: string | null;
  /** Null when entered by hand. */
  extracted: { at: string; source: ExtractionSource; meeting_id: string | null } | null;
  review: ConsultReview | null;
};

/** One line per class: `25: Clothing, namely t-shirts`. A line with no number is goods whose class was not stated. */
export function formatClassLines(classes: readonly ConsultClass[]): string {
  return classes.map((c) => (c.class === null ? c.goods : c.goods ? `${c.class}: ${c.goods}` : `${c.class}:`)).join("\n");
}
