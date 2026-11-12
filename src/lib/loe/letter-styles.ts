/**
 * The engagement letter's paragraph STYLES: the one list, and the one place a style marker is read. Pure: no database, no
 * server imports, no HTML.
 *
 * A firm writes a style marker at the very start of a paragraph of its letter TEMPLATE, in single braces, one name or several
 * separated by commas, then (usually) a line break and the paragraph's text:
 *
 *   {center, small, rule-below}
 *   333 S.E. 2nd Avenue Suite 2000, Miami, FL 33131 | (305) 712-6960 | info@rpblawfirm.com
 *
 * Single braces only, so a marker can never be mistaken for a `{{field}}` and never leaves a `{{` or `}}` behind (lectual 0106's
 * approve check refuses those). A paragraph that starts with `{{` is a merge field, never a marker.
 *
 * Template-only: `renderLetter` reads the marker from the TEMPLATE before any value is merged, so a client who types
 * "{center}" (or anything else) into a field gets those characters on the letter and styles nothing.
 *
 * Words only in the agreement: a style is how a paragraph is DRAWN (page, previews, PDF). It is not part of the agreement text that
 * is hashed and stored, nor of the canonical form the page and the server compare, so the formatting can be refined later without
 * changing what was signed. A letter with no markers renders, hashes and stores exactly as it did before styles existed.
 *
 * An unknown name, an empty marker or a marker with no text after it is a template error (fail closed): Settings shows it and
 * Approve refuses it, and `renderLetter` makes no letter from it.
 */

export const LETTER_STYLE_NAMES = [
  /** Centred. */
  "center",
  /** The whole paragraph in bold. */
  "bold",
  /** Smaller text (the letterhead address line). */
  "small",
  /** Indented about a third of the page (2.25in on paper; less on a narrow screen). The signature block. */
  "indent",
  /** A thick rule under the paragraph, across the full width (under the letterhead). */
  "rule-below",
  /** The paragraph's first line in bold and underlined ("Via Email: ..."). */
  "bold-underline-first-line",
  /** Extra space above the paragraph. */
  "space-before",
] as const;

export type LetterStyleName = (typeof LETTER_STYLE_NAMES)[number];

export function isLetterStyleName(name: string): name is LetterStyleName {
  return (LETTER_STYLE_NAMES as readonly string[]).includes(name);
}

/**
 * A marker at the start of a paragraph: `{` + anything but braces and line breaks + `}`, then spaces and at most one line
 * break. `{{date}}` does not match (its second character is a brace).
 */
const MARKER = /^[ \t]*\{([^{}\n]*)\}[ \t]*(?:\n|$)?/;

export type StyleParse =
  | { marker: false; rest: string }
  | { marker: true; ok: true; styles: LetterStyleName[]; rest: string }
  | { marker: true; ok: false; problems: string[]; rest: string };

/** The sentence for a name that is not a style. Fixed apart from the name the firm wrote. */
export function unknownStyleSentence(name: string): string {
  return `{${name}} is not a letter style. Use only: ${LETTER_STYLE_NAMES.join(", ")}.`;
}
export const EMPTY_STYLE_SENTENCE = "A style marker {} names no style.";
export const STYLE_WITHOUT_TEXT_SENTENCE = "A style marker must be followed by the paragraph's text.";

/**
 * Reads the style marker at the start of ONE template paragraph (before merging). Styles come back de-duplicated in the order of
 * `LETTER_STYLE_NAMES`, so `{bold, center}` and `{center,bold}` are the same style. `rest` is the paragraph without the marker.
 */
export function parseParagraphStyle(paragraph: string): StyleParse {
  const m = MARKER.exec(paragraph);
  if (!m) return { marker: false, rest: paragraph };
  const rest = paragraph.slice(m[0].length);
  const names = m[1].split(",").map((s) => s.trim());
  const problems: string[] = [];
  if (names.every((n) => n.length === 0)) problems.push(EMPTY_STYLE_SENTENCE);
  else for (const n of names) if (!isLetterStyleName(n)) problems.push(unknownStyleSentence(n));
  if (rest.trim().length === 0) problems.push(STYLE_WITHOUT_TEXT_SENTENCE);
  if (problems.length > 0) return { marker: true, ok: false, problems, rest };
  const set = new Set(names);
  return { marker: true, ok: true, styles: LETTER_STYLE_NAMES.filter((s) => set.has(s)), rest };
}

/** Splits a letter body into its paragraphs exactly as `renderLetter` does (a blank line separates them). */
export function letterParagraphs(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim().length > 0);
}

/** Every style problem in a template body, de-duplicated, in order. Empty when the markers are all good (or there are none). */
export function letterStyleProblems(body: string): string[] {
  const out: string[] = [];
  for (const p of letterParagraphs(body)) {
    const parsed = parseParagraphStyle(p);
    if (parsed.marker && !parsed.ok) for (const s of parsed.problems) if (!out.includes(s)) out.push(s);
  }
  return out;
}

/** Whether a rendered block carries a style. */
export function hasStyle(block: { style?: readonly LetterStyleName[] }, name: LetterStyleName): boolean {
  return Array.isArray(block.style) && block.style.includes(name);
}

/** The CSS classes for a block's styles (`loe-s-<name>`), or undefined for a block with none. One map for every web view. */
export function letterStyleClasses(block: { style?: readonly LetterStyleName[] }): string | undefined {
  if (!Array.isArray(block.style) || block.style.length === 0) return undefined;
  return block.style.map((s) => `loe-s-${s}`).join(" ");
}

/** A paragraph's text split for `bold-underline-first-line`: the first line, then the rest (starting with its line break). */
export function splitFirstLine(text: string): { first: string; rest: string } {
  const at = text.indexOf("\n");
  return at < 0 ? { first: text, rest: "" } : { first: text.slice(0, at), rest: text.slice(at) };
}
