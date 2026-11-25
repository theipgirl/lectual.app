// The two files a FULL consult prep carries, and the words the email uses for them (S2b, pure).
//
// PORTED in part from lawmatics-mcp src/consult-brief/attachments.ts @ 3bcbe3f (see PORTED_FROM.md): `capPdfMarks`, `stripClassNumbers`,
// `cutText` and `splitPrefix` (the PDF failure reasons are P3's own `PACKAGES_SPEC_ERROR_REASONS`). Changes: the USPTO file is the site's own export workbook (`tmSearchResults<date>.xlsx`)
// instead of the CSV zip; reasons name the firm's package list (no "firm config"); every missing file is a CODE here and a fixed sentence
// when the email is written, so a code (never a name) is what the prep's marker stores.
//
// A file that cannot be built never blocks the brief or the email: the email names what is missing, in a fixed sentence.

import { markIsGrounded } from "./judge/judge";
import type { JudgeFacts } from "./judge/facts";
import type { Judgment } from "./judge/schemas";
import { MAX_MARKS, PACKAGES_SPEC_ERROR_CODES, PACKAGES_SPEC_ERROR_REASONS, type PackagesSpecErrorCode, type PackagesSpecInput } from "./pdf/spec";

export const MAX_CATEGORIES_PER_MARK = 6;
export const MAX_CATEGORY_CHARS = 120;

/** The two files. */
export type PrepFileKind = "uspto_xlsx" | "packages_pdf";
export const PREP_FILE_KINDS: readonly PrepFileKind[] = ["uspto_xlsx", "packages_pdf"];

/** A built file, in memory. `fileName` is shown in the email and stored on the lead; it never reaches a log. */
export type PrepFile = { kind: PrepFileKind; fileName: string; bytes: Buffer };

/**
 * What became of each file when the full prep was built (codes only: this is what the marker stores).
 *   built            built (and attached, unless it is too large or the mail service refuses attachments)
 *   none             the route has no files (a general or dispute matter)
 *   skipped          nothing to search: no mark is confirmed
 *   unavailable      the USPTO search did not answer
 *   failed           the file could not be built
 *   budget           the run had no time left to build it
 *   <a PDF code>     the packages PDF's own reason (PackagesSpecError codes)
 */
export type AttachCode = string;
export type AttachPlan = Partial<Record<PrepFileKind, AttachCode>>;

/** Resend refuses an email over 40 MB, base64 included. These keep well under it. */
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const FILE_WORDS: Record<PrepFileKind, string> = {
  uspto_xlsx: "USPTO search results workbook",
  packages_pdf: "Packages PDF",
};

const isPdfCode = (code: string): code is PackagesSpecErrorCode => (PACKAGES_SPEC_ERROR_CODES as readonly string[]).includes(code);

/** The fixed sentence for a file that is not on the email. Never a client's name, a mark or a file name. */
export function missingLine(kind: PrepFileKind, code: AttachCode): string | null {
  const what = FILE_WORDS[kind];
  switch (code) {
    case "built":
    case "none":
      return null;
    case "skipped":
      return kind === "uspto_xlsx" ? "No USPTO search results workbook: no mark is confirmed yet." : `${what} not attached: no mark is confirmed yet.`;
    case "unavailable":
      return `${what} not attached: the USPTO search was unavailable.`;
    case "budget":
      return `${what} not attached: there was no time left to build it in this run.`;
    case "too_large":
      return `${what} not attached: it is too large to send by email. It is in the lead's Documents & files.`;
    case "not_loaded":
      return `${what} not attached: the saved copy couldn't be read for this email.`;
    case "refused":
      return `${what} not attached: the mail service refused attachments on this email.`;
    default:
      if (isPdfCode(code)) return `${what} not attached: ${PACKAGES_SPEC_ERROR_REASONS[code]}.`;
      return `${what} not attached: it could not be built.`;
  }
}

/** "Attached: <file name>". The name is the file's own (client and mark), which is fine in the firm's internal email. */
export const attachedLine = (fileName: string): string => `Attached: ${fileName}`;
export const NO_ATTACHMENTS_LINE = "No attachments for this matter type.";

/** Cut at `max` characters on a word boundary, ending with "…". */
export function cutText(s: string, max: number): { text: string; cut: boolean } {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return { text: t, cut: false };
  let head = t.slice(0, max - 1);
  const space = head.lastIndexOf(" ");
  if (space > max / 2) head = head.slice(0, space);
  return { text: `${head.replace(/[\s,;:.–—-]+$/, "")}…`, cut: true };
}

const PREFIXES = /^(mr|mrs|ms|mx|miss|dr|prof)\.?\s+/i;

/** "Ms. Kenasha Paul" -> { prefix: "Ms.", name: "Kenasha Paul" }. */
export function splitPrefix(full: string): { prefix: string | null; name: string } {
  const m = full.match(PREFIXES);
  if (!m) return { prefix: null, name: full };
  const raw = m[0].trim();
  return { prefix: raw.endsWith(".") || /^miss$/i.test(raw) ? raw : `${raw}.`, name: full.slice(m[0].length).trim() };
}

/** Removes "(Class 41)", "Class 41", "IC 041", "Classes 9 and 16" from client-facing text. */
export function stripClassNumbers(text: string): string {
  return text
    .replace(/\s*\(\s*(?:international\s+)?(?:class(?:es)?|IC)\s*[\d,\s&and]+\)/gi, "")
    .replace(/\b(?:international\s+)?(?:class(?:es)?|IC)\s*0*\d{1,2}(?:\s*(?:,|&|and)\s*0*\d{1,2})*\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/[\s,;:–—-]+$/, "")
    .trim();
}

/**
 * The model's PDF marks, capped (3 marks, 6 categories, 120 characters each) and GROUNDED: a mark the client did not write is not drawn.
 * `scrub` is the brief's scrubber, so a price the model slipped into a category is removed first; class numbers are stripped too.
 */
export function capPdfMarks(
  pdfMarks: NonNullable<Judgment["trademark"]>["package"]["pdfMarks"],
  facts: JudgeFacts,
  scrub: (s: string) => string,
): PackagesSpecInput["marks"] {
  return pdfMarks
    .filter((m) => markIsGrounded(m.mark, facts))
    .slice(0, MAX_MARKS)
    .map((m) => ({
      name: m.mark.trim(),
      categories: m.categories
        .slice(0, MAX_CATEGORIES_PER_MARK)
        .map((c) => ({ text: cutText(stripClassNumbers(scrub(c.text)), MAX_CATEGORY_CHARS).text, priority: c.priority }))
        .filter((c) => c.text.length > 0),
    }));
}

/**
 * The files that go on ONE email and the manifest lines for it. Files are taken in order while each is under the per-file limit and the
 * total stays under the overall one; any other is named as too large. `refused`: the mail service refused attachments, so every file
 * is named as missing and none is sent.
 */
export function attachmentsForEmail(
  plan: AttachPlan,
  files: readonly PrepFile[],
  opts: { refused?: boolean; loadFailed?: boolean } = {},
): { attach: PrepFile[]; lines: string[] } {
  const kinds = PREP_FILE_KINDS.filter((k) => plan[k] !== undefined);
  if (kinds.length === 0 || kinds.every((k) => plan[k] === "none")) return { attach: [], lines: [NO_ATTACHMENTS_LINE] };
  const attach: PrepFile[] = [];
  const lines: string[] = [];
  let total = 0;
  for (const kind of kinds) {
    const code = plan[kind] as AttachCode;
    if (code !== "built") {
      const line = missingLine(kind, code);
      if (line) lines.push(line);
      continue;
    }
    const file = files.find((f) => f.kind === kind);
    if (!file) {
      lines.push(missingLine(kind, opts.loadFailed ? "not_loaded" : "failed") as string);
      continue;
    }
    if (opts.refused) {
      lines.push(missingLine(kind, "refused") as string);
      continue;
    }
    if (file.bytes.length > MAX_ATTACHMENT_BYTES || total + file.bytes.length > MAX_TOTAL_ATTACHMENT_BYTES) {
      lines.push(missingLine(kind, "too_large") as string);
      continue;
    }
    total += file.bytes.length;
    attach.push(file);
    lines.push(attachedLine(file.fileName));
  }
  return { attach, lines };
}
