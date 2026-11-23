import { createHash } from "node:crypto";

/**
 * The firm attorney's own signing words (lectual 0117 `client_proposal_signing_words`): the rules, pure.
 *
 * Lectual writes NONE of these words. The consent line, the consent text, the line beside Sign, the line under the signature box
 * and both emails are typed by the firm in Settings and approved by a named approver; each signing request snapshots them (text +
 * sha256), so a later approval never changes an open link. The rules below MIRROR 0117 (its length CHECK and
 * `client_proposal_signing_words_fields_ok`); the database is the boundary, these only let the page say what is wrong first.
 */

export const WORDS_FIELDS = [
  "consent_line",
  "consent_text",
  "sign_line",
  "box_note",
  "link_subject",
  "link_body",
  "copy_subject",
  "copy_body",
] as const;

export type WordsField = (typeof WORDS_FIELDS)[number];
export type SigningWords = Record<WordsField, string>;

/** The same numbers as 0117's `client_proposal_signing_words_lens` (after btrim). */
export const WORDS_LIMITS: Record<WordsField, number> = {
  consent_line: 300,
  consent_text: 8000,
  sign_line: 600,
  box_note: 600,
  link_subject: 200,
  link_body: 8000,
  copy_subject: 200,
  copy_body: 8000,
};

/** Which merge fields each words field may use, and the one it must use exactly once (0117's approve check). */
export const WORDS_MERGE: Record<WordsField, { allowed: readonly string[]; required: string | null }> = {
  consent_line: { allowed: [], required: null },
  consent_text: { allowed: [], required: null },
  sign_line: { allowed: [], required: null },
  box_note: { allowed: [], required: null },
  link_subject: { allowed: ["client_name", "firm_name"], required: null },
  link_body: { allowed: ["signing_link", "client_name", "firm_name", "link_expires"], required: "signing_link" },
  copy_subject: { allowed: ["client_name", "firm_name"], required: null },
  copy_body: { allowed: ["client_name", "firm_name"], required: null },
};

export type WordsIssue = { field: WordsField; problem: "empty" | "too_long" | "two_lines" | "fields" };

/** Postgres `btrim` with no second argument trims spaces only. */
const btrim = (v: string): string => v.replace(/^ +| +$/g, "");

/** 0117's `client_proposal_signing_words_fields_ok`, mirrored. */
export function fieldsOk(text: string, allowed: readonly string[], required: string | null): boolean {
  if (/(\{\{|\}\})/.test(text.replace(/\{\{[a-z_]+\}\}/g, ""))) return false;
  let count = 0;
  for (const m of text.matchAll(/\{\{([a-z_]+)\}\}/g)) {
    if (!allowed.includes(m[1])) return false;
    if (required !== null && m[1] === required) count += 1;
  }
  return required === null || count === 1;
}

/** Every rule a set of words must pass to be APPROVED (a draft may be saved with merge-field problems, never empty or oversize). */
export function wordsIssues(words: SigningWords): WordsIssue[] {
  const issues: WordsIssue[] = [];
  for (const field of WORDS_FIELDS) {
    const v = btrim(words[field] ?? "");
    if (v.length === 0) issues.push({ field, problem: "empty" });
    else if (v.length > WORDS_LIMITS[field]) issues.push({ field, problem: "too_long" });
    else if ((field === "link_subject" || field === "copy_subject") && /[\r\n]/.test(words[field])) issues.push({ field, problem: "two_lines" });
    else if (!fieldsOk(words[field], WORDS_MERGE[field].allowed, WORDS_MERGE[field].required)) issues.push({ field, problem: "fields" });
  }
  return issues;
}

/** The problems that stop even a DRAFT from being stored (the database's length and one-line CHECKs). */
export function draftBlockingIssues(words: SigningWords): WordsIssue[] {
  return wordsIssues(words).filter((i) => i.problem !== "fields");
}

/** sha256 hex of the eight fields joined by U+001F, in 0117's order (signing_open compares it). */
export function wordsSha256(words: SigningWords): string {
  return createHash("sha256").update(WORDS_FIELDS.map((f) => words[f]).join("\u001f"), "utf8").digest("hex");
}

/** sha256 hex of the consent text, as 0117 stores it on the request (`consent_sha256`). */
export function consentSha256(consentText: string): string {
  return createHash("sha256").update(consentText, "utf8").digest("hex");
}

export type EmailMergeValues = Partial<Record<"signing_link" | "client_name" | "firm_name" | "link_expires", string>>;

/**
 * The approved email words with their merge fields filled, in ONE pass: a value is never re-merged, so a client name that looks
 * like `{{signing_link}}` stays literal text. Plain text only (no HTML). A field with no value fails (`ok: false`): an email is
 * never sent with a hole in it.
 */
export function renderEmailWords(template: string, values: EmailMergeValues): { ok: true; text: string } | { ok: false } {
  let missing = false;
  const text = template.replace(/\{\{([a-z_]+)\}\}/g, (_, name: string) => {
    const v = (values as Record<string, string | undefined>)[name];
    if (typeof v !== "string") {
      missing = true;
      return "";
    }
    return v;
  });
  return missing ? { ok: false } : { ok: true, text };
}

/** Labels that NAME each field (Settings). Names only, never sample wording. */
export const WORDS_LABELS: Record<WordsField, string> = {
  consent_line: "Consent button line",
  consent_text: "Consent text",
  sign_line: "Line beside Sign",
  box_note: "Line under the signature box",
  link_subject: "Signing link email subject",
  link_body: "Signing link email body",
  copy_subject: "Signed copy email subject",
  copy_body: "Signed copy email body",
};
