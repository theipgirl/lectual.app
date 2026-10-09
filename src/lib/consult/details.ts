/**
 * Consult details: what was SAID on a consultation about each mark, captured so
 * the work after the engagement letter (prosecution, deferred) has it.
 *
 * Source: Aug 29 intake SOP §2.2 — "Filing basis per mark: 1A (in use) or 1B
 * (intent to use)… decided at intake and must be captured here so the deferred
 * prosecution work has it." Under examination a 1(b) application is not an
 * office-action response, so a wrong or guessed basis misleads everything after.
 *
 * The rules this file enforces, because each was learned the hard way elsewhere
 * in this product:
 *
 *  - It is a record of what was said, not advice. The extraction schema asks
 *    the model to report; it never asks it to decide a basis, pick a class or
 *    recommend a price. A basis the model cannot point to evidence for is
 *    downgraded to `unknown` here, whatever the model answered.
 *  - `unknown` is a real value. It is stored, shown, and never carried onto a
 *    matter as if it were an answer.
 *  - Nothing is relied on until a person has reviewed it: only a `review`
 *    stamped by staff makes the details eligible to carry onto a matter. A
 *    later re-extraction never overwrites a reviewed record.
 *  - Nothing here sends anything to anyone.
 *
 * Pure: no server imports, so client components can use the labels and types
 * and every rule is testable without a database or a model.
 */

import { z } from "zod";
import { MAX_NICE_CLASS, MIN_NICE_CLASS, parseCivilDate, type FilingBasis } from "@/lib/matters/ip-fields";
import {
  CONSULT_BASES,
  CONSULT_BASIS_LABEL,
  MARK_TYPES,
  MAX_MARKS,
  MAX_EVIDENCE_TEXT,
  MAX_FREE_TEXT,
  MAX_GOODS_TEXT,
  MAX_MARK_TEXT,
  type ConsultBasis,
  type ConsultClass,
  type ConsultMark,
  type ExtractionSource,
  type MarkType,
  type StoredConsultDetails,
} from "./vocab";

export * from "./vocab";

/* ───────────────── what the model is asked for (one call) ───────────────── */

/**
 * Deliberately permissive: no min/max or patterns. A constraint the model
 * misses would fail the whole follow-up draft, and the draft matters more than
 * this extraction. Everything is checked in `normalizeExtraction` instead,
 * which drops what it cannot trust.
 */
export const ExtractedMarkSchema = z.object({
  mark: z.string().describe("The mark as discussed: the words themselves, or a few words describing the logo for a design mark"),
  mark_type: z
    .enum(["word", "design", "unknown"])
    .describe("word if it was described as just the name or words; design if it was described as a logo or image; unknown if the notes do not say"),
  classes: z
    .array(
      z.object({
        class: z.number().nullable().describe("The international class number ONLY if the notes state it for these goods or services; otherwise null"),
        goods: z.string().describe("The goods or services as stated in the notes"),
      }),
    )
    .describe("The classes and goods/services discussed for this mark, as stated. Empty if none were discussed"),
  filing_basis: z
    .enum(["1a", "1b", "unknown"])
    .describe(
      "1a ONLY if the notes say the mark is already in use in commerce for these goods or services; 1b ONLY if they say it is not in use yet and the client intends to use it; otherwise unknown. Never infer it",
    ),
  basis_evidence: z
    .string()
    .nullable()
    .describe("The words in the notes that state the basis, quoted or closely paraphrased. null when filing_basis is unknown"),
  first_use_date: z.string().nullable().describe("YYYY-MM-DD, ONLY if a complete first-use date is stated in the notes; otherwise null"),
});

export const ConsultDetailsExtractSchema = z.object({
  marks: z.array(ExtractedMarkSchema).describe("One entry per mark discussed. Empty if no mark was discussed"),
  recommended_package: z.string().nullable().describe("The package the attorney recommended or discussed, as named in the notes; null if none"),
  discount_discussed: z.string().nullable().describe("Any discount discussed, as the notes put it; null if none. Do not invent or compute one"),
});
export type ConsultDetailsExtract = z.infer<typeof ConsultDetailsExtractSchema>;

const StoredSchema = z.object({
  version: z.literal(1),
  rev: z.number().int().min(0),
  marks: z.array(
    z.object({
      id: z.string().min(1),
      mark: z.string(),
      mark_type: z.enum(MARK_TYPES),
      classes: z.array(z.object({ class: z.number().int().nullable(), goods: z.string() })),
      filing_basis: z.enum(CONSULT_BASES),
      extracted_basis: z.enum(CONSULT_BASES).nullable(),
      basis_evidence: z.string().nullable(),
      first_use_date: z.string().nullable(),
    }),
  ),
  recommended_package: z.string().nullable(),
  discount_discussed: z.string().nullable(),
  extracted: z.object({ at: z.string(), source: z.enum(["post-consult-agent", "meeting-follow-up", "manual"]), meeting_id: z.string().nullable() }).nullable(),
  review: z
    .object({
      reviewed_at: z.string(),
      reviewed_by: z.string().nullable(),
      reviewed_by_name: z.string().nullable(),
      reviewed_by_role: z.string().nullable(),
    })
    .nullable(),
});

export type StoredRead = { kind: "none" } | { kind: "ok"; details: StoredConsultDetails } | { kind: "invalid" };

/**
 * Reads `consult_details` off a `crm_consult_note.notes` value. Three results,
 * never two: absent (`none`), readable (`ok`), and present-but-unreadable
 * (`invalid`), which callers must NOT treat as absent.
 */
export function readStoredDetails(notes: unknown): StoredRead {
  if (!notes || typeof notes !== "object" || Array.isArray(notes)) return { kind: "none" };
  const raw = (notes as Record<string, unknown>).consult_details;
  if (raw === undefined || raw === null) return { kind: "none" };
  const parsed = StoredSchema.safeParse(raw);
  return parsed.success ? { kind: "ok", details: parsed.data as StoredConsultDetails } : { kind: "invalid" };
}

/** `notes` with `consult_details` set, every other key (summary, marks_discussed…) untouched. */
export function withConsultDetails(notes: unknown, details: StoredConsultDetails): Record<string, unknown> {
  const base = notes && typeof notes === "object" && !Array.isArray(notes) ? { ...(notes as Record<string, unknown>) } : {};
  base.consult_details = details;
  return base;
}

/* ─────────────────────────── cleaning what came in ──────────────────────── */

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}

function validClass(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= MIN_NICE_CLASS && n <= MAX_NICE_CLASS ? n : null;
}

function validDate(value: unknown): string | null {
  const text = clean(value, 10);
  if (!text) return null;
  try {
    return parseCivilDate(text);
  } catch {
    return null;
  }
}

/** Case- and punctuation-insensitive key for "is this the same mark". */
export function markKey(text: string | null | undefined): string {
  return (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function dedupeClasses(list: ConsultClass[]): ConsultClass[] {
  const seen = new Set<string>();
  const out: ConsultClass[] = [];
  for (const c of list) {
    const key = `${c.class ?? "-"}|${c.goods.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Turns the model's answer into a stored record, or null when it is not even
 * the right shape. Rules, in order of importance:
 *
 *  1. A basis of 1a/1b with no evidence behind it becomes `unknown`.
 *  2. A class number outside 1-45 is dropped; the goods stay, unclassified.
 *  3. A first-use date that is not a real complete date is dropped.
 *  4. Marks with no text are dropped; the same mark twice is one mark.
 */
export function normalizeExtraction(
  raw: unknown,
  meta: { now: Date; source: Exclude<ExtractionSource, "manual">; meetingId?: string | null },
): StoredConsultDetails | null {
  const parsed = ConsultDetailsExtractSchema.safeParse(raw);
  if (!parsed.success) return null;

  const byKey = new Map<string, Omit<ConsultMark, "id">>();
  for (const m of parsed.data.marks) {
    const text = clean(m.mark, MAX_MARK_TEXT);
    if (!text) continue;
    const classes: ConsultClass[] = [];
    for (const c of m.classes) {
      const goods = clean(c.goods, MAX_GOODS_TEXT) ?? "";
      const cls = validClass(c.class);
      if (cls === null && !goods) continue;
      classes.push({ class: cls, goods });
    }
    const evidence = clean(m.basis_evidence, MAX_EVIDENCE_TEXT);
    const basis: ConsultBasis = m.filing_basis !== "unknown" && evidence ? m.filing_basis : "unknown";
    const entry: Omit<ConsultMark, "id"> = {
      mark: text,
      mark_type: m.mark_type,
      classes: dedupeClasses(classes),
      filing_basis: basis,
      extracted_basis: basis,
      basis_evidence: basis === "unknown" ? null : evidence,
      first_use_date: validDate(m.first_use_date),
    };
    const key = `${markKey(text)}|${entry.mark_type}`;
    const prior = byKey.get(key);
    if (!prior) {
      byKey.set(key, entry);
    } else {
      // The same mark said twice. Keep what is known; where the two disagree
      // on the basis, it is not known.
      prior.classes = dedupeClasses([...prior.classes, ...entry.classes]);
      if (prior.filing_basis !== entry.filing_basis) {
        prior.filing_basis = "unknown";
        prior.extracted_basis = "unknown";
        prior.basis_evidence = null;
      }
      prior.first_use_date ??= entry.first_use_date;
    }
  }

  const marks = [...byKey.values()].slice(0, MAX_MARKS).map((m, i) => ({ id: `m${i + 1}`, ...m }));
  return {
    version: 1,
    rev: 0,
    marks,
    recommended_package: clean(parsed.data.recommended_package, MAX_FREE_TEXT),
    discount_discussed: clean(parsed.data.discount_discussed, MAX_FREE_TEXT),
    extracted: { at: meta.now.toISOString(), source: meta.source, meeting_id: meta.meetingId ?? null },
    review: null,
  };
}

/* ───────────────────────── "class: goods" lines ─────────────────────────── */

export class ConsultInputError extends Error {}


/**
 * The inverse of `formatClassLines`, for what a person typed. A number only
 * counts as a class when it is followed by a colon (`25: …`, `Class 25: …`) or
 * stands alone, so "24-hour fitness classes" stays a goods description rather
 * than becoming class 24. A class outside 1-45 is refused, not dropped.
 */
export function parseClassLines(text: string | null | undefined): ConsultClass[] {
  const out: ConsultClass[] = [];
  for (const line of (text ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    const m = /^(?:class\s*)?(\d{1,3})\s*(?::\s*(.*))?$/i.exec(t) ?? /^class\s*(\d{1,3})\s*[-–—]\s*(.+)$/i.exec(t);
    if (m) {
      const n = Number(m[1]);
      if (n < MIN_NICE_CLASS || n > MAX_NICE_CLASS) {
        throw new ConsultInputError(`International class ${n} is out of range — classes run ${MIN_NICE_CLASS}–${MAX_NICE_CLASS}.`);
      }
      out.push({ class: n, goods: (m[2] ?? "").trim().slice(0, MAX_GOODS_TEXT) });
    } else {
      out.push({ class: null, goods: t.slice(0, MAX_GOODS_TEXT) });
    }
  }
  return dedupeClasses(out);
}

/* ───────────────────────────── the review form ──────────────────────────── */

export type ReviewMarkInput = {
  id: string | null;
  mark: string;
  mark_type: MarkType;
  filing_basis: ConsultBasis;
  first_use_date: string | null;
  classes: ConsultClass[];
};
export type ReviewInput = {
  marks: ReviewMarkInput[];
  recommended_package: string | null;
  discount_discussed: string | null;
};

type FormLike = { get(name: string): FormDataEntryValue | null };

function oneOf<T extends string>(allowed: readonly T[], value: FormDataEntryValue | null, fallback?: T): T | null {
  const v = typeof value === "string" ? value.trim() : "";
  if (!v && fallback) return fallback;
  return (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * Reads the review form. Everything is validated here because the action is its
 * own POST endpoint: a hand-built request gets the same refusals as the form.
 * Slots are `m0_*`, `m1_*`…; an empty new slot is skipped, and removal is an
 * explicit `m{n}_remove` — a mark is never dropped just because it was missing.
 */
export function parseReviewForm(form: FormLike): { ok: true; value: ReviewInput } | { ok: false; error: string } {
  try {
    const count = Number(form.get("markCount"));
    if (!Number.isInteger(count) || count < 0 || count > MAX_MARKS + 1) throw new ConsultInputError("That form isn't valid. Reload the page and try again.");
    const marks: ReviewMarkInput[] = [];
    for (let i = 0; i < count; i += 1) {
      const get = (k: string) => form.get(`m${i}_${k}`);
      const id = clean(get("id"), 40);
      const text = clean(get("text"), MAX_MARK_TEXT);
      const rawClasses = typeof get("classes") === "string" ? (get("classes") as string) : "";
      const touched = Boolean(id || text || rawClasses.trim() || clean(get("first_use"), 10));
      if (get("remove") === "on" || !touched) continue;
      if (!text) throw new ConsultInputError(`Mark ${i + 1} needs its text — or tick “Remove this mark”.`);
      const mark_type = oneOf(MARK_TYPES, get("type"), "unknown");
      const filing_basis = oneOf(CONSULT_BASES, get("basis"), "unknown");
      if (!mark_type || !filing_basis) throw new ConsultInputError("That form isn't valid. Reload the page and try again.");
      let first_use_date: string | null;
      try {
        first_use_date = parseCivilDate(get("first_use"));
      } catch (e) {
        throw new ConsultInputError(`Mark ${i + 1}: ${(e as Error).message}`);
      }
      let classes: ConsultClass[];
      try {
        classes = parseClassLines(rawClasses);
      } catch (e) {
        throw new ConsultInputError(`Mark ${i + 1}: ${(e as Error).message}`);
      }
      marks.push({ id, mark: text, mark_type, filing_basis, first_use_date, classes });
    }
    if (marks.length > MAX_MARKS) throw new ConsultInputError(`A consult can list up to ${MAX_MARKS} marks.`);
    return {
      ok: true,
      value: {
        marks,
        recommended_package: clean(form.get("package"), MAX_FREE_TEXT),
        discount_discussed: clean(form.get("discount"), MAX_FREE_TEXT),
      },
    };
  } catch (e) {
    if (e instanceof ConsultInputError) return { ok: false, error: e.message };
    throw e;
  }
}

/**
 * The record after a person has reviewed it. Edits an existing mark by `id`
 * (keeping what the model read and its evidence, so a correction stays
 * visible), appends a new one for a blank id, and stamps the review. A mark
 * the reviewer did not submit is gone: the form lists every mark, so absence
 * means they ticked Remove.
 */
export function applyReview(
  existing: StoredConsultDetails | null,
  input: ReviewInput,
  reviewer: { userId: string | null; name: string | null; role: string | null },
  now: Date,
): StoredConsultDetails {
  const prior = new Map((existing?.marks ?? []).map((m) => [m.id, m]));
  const taken = new Set<string>();
  let next = 1;
  const freshId = () => {
    while (taken.has(`m${next}`) || prior.has(`m${next}`)) next += 1;
    const id = `m${next}`;
    taken.add(id);
    return id;
  };
  const marks: ConsultMark[] = input.marks.map((m) => {
    const old = m.id ? prior.get(m.id) : undefined;
    if (old && !taken.has(old.id)) {
      taken.add(old.id);
      return { ...old, mark: m.mark, mark_type: m.mark_type, classes: m.classes, filing_basis: m.filing_basis, first_use_date: m.first_use_date };
    }
    return {
      id: freshId(),
      mark: m.mark,
      mark_type: m.mark_type,
      classes: m.classes,
      filing_basis: m.filing_basis,
      extracted_basis: null,
      basis_evidence: null,
      first_use_date: m.first_use_date,
    };
  });
  return {
    version: 1,
    rev: (existing?.rev ?? 0) + 1,
    marks,
    recommended_package: input.recommended_package,
    discount_discussed: input.discount_discussed,
    extracted: existing?.extracted ?? null,
    review: { reviewed_at: now.toISOString(), reviewed_by: reviewer.userId, reviewed_by_name: reviewer.name, reviewed_by_role: reviewer.role },
  };
}

/* ──────────────────────── carrying onto a matter ────────────────────────── */

export type CarrySkip = "no_details" | "not_reviewed" | "no_marks" | "ambiguous_marks" | "mark_mismatch" | "unreadable" | "unavailable";

/** The crm_matter columns a reviewed consult can fill (a subset of MatterIpFields). */
export type MatterCarryFields = {
  markText?: string;
  filingBasis?: FilingBasis;
  internationalClasses?: number[];
  goodsServices?: string;
};

export type MatterCarry = {
  fields: MatterCarryFields;
  /** Column names, for the timeline. */
  carried: string[];
  skipped: CarrySkip | null;
};

const carryNothing = (skipped: CarrySkip): MatterCarry => ({ fields: {}, carried: [], skipped });

/**
 * Which reviewed mark, if any, belongs on a matter — and what of it can be put
 * in columns that exist (mark text, basis, classes, goods/services; there is
 * no first-use column, so that date is not carried).
 *
 * Conservative on purpose. A matter holds ONE mark, so:
 *  - the mark the caller already knows (the one the client signed for, or the
 *    lead's) picks the consult mark with the same text; if none matches,
 *    nothing is carried — a basis attached to a different mark than the one
 *    being filed is worse than a blank;
 *  - with no mark known, a single reviewed mark is taken, and several marks
 *    carry nothing (staff choose);
 *  - `unknown` carries no basis, and an unreviewed record carries nothing.
 *
 * `preferredMark` is the text the matter will have; when it is given, the
 * matter keeps it and `markText` is not returned.
 */
export function matterFieldsFromDetails(details: StoredConsultDetails | null, preferredMark: string | null | undefined): MatterCarry {
  if (!details) return carryNothing("no_details");
  if (!details.review) return carryNothing("not_reviewed");
  const marks = details.marks.filter((m) => m.mark.trim());
  if (marks.length === 0) return carryNothing("no_marks");

  const wanted = markKey(preferredMark);
  let chosen: ConsultMark | undefined;
  if (wanted) {
    const matches = marks.filter((m) => markKey(m.mark) === wanted);
    if (matches.length === 0) return carryNothing("mark_mismatch");
    // Word and design versions of one name share its text; the word mark is
    // the one a plain name refers to, and two of one kind are ambiguous.
    chosen = matches.length === 1 ? matches[0] : matches.filter((m) => m.mark_type === "word").length === 1 ? matches.find((m) => m.mark_type === "word") : undefined;
    if (!chosen) return carryNothing("ambiguous_marks");
  } else {
    if (marks.length > 1) return carryNothing("ambiguous_marks");
    chosen = marks[0];
  }

  const fields: MatterCarryFields = {};
  const carried: string[] = [];
  if (!wanted) {
    fields.markText = chosen.mark;
    carried.push("mark_text");
  }
  if (chosen.filing_basis === "1a" || chosen.filing_basis === "1b") {
    fields.filingBasis = chosen.filing_basis;
    carried.push("filing_basis");
  }
  const numbers = [...new Set(chosen.classes.map((c) => c.class).filter((n): n is number => n !== null))].sort((a, b) => a - b);
  if (numbers.length > 0) {
    fields.internationalClasses = numbers;
    carried.push("international_classes");
  }
  const goods = chosen.classes
    .filter((c) => c.goods)
    .map((c) => (c.class === null ? c.goods : `Class ${c.class}: ${c.goods}`))
    .join("\n");
  if (goods) {
    fields.goodsServices = goods;
    carried.push("goods_services");
  }
  return { fields, carried, skipped: null };
}

/** "§1(b) — Intent to use" for a basis, or the honest "Unknown — not stated". */
export function basisLabel(basis: ConsultBasis): string {
  return CONSULT_BASIS_LABEL[basis];
}
