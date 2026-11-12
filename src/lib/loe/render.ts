import { LOE_FIELDS, MERGE_TOKEN, isLoeField, type LoeField, type LoeValues } from "./fields";

/**
 * Merges a letter body with values and returns PLAIN TEXT BLOCKS, never HTML.
 *
 * The body is split into paragraphs first (a blank line separates them), a
 * paragraph may start with a bold lead-in written `**Lead-in.**`, and only then
 * are values merged, in ONE pass over the template. A value is never scanned for
 * markers again, so a client who types `{{signer_name}}`, `}}` or `<script>`
 * gets exactly those characters on the letter. The caller draws each block as
 * React text.
 *
 * Fail closed: an unknown field, an unclosed `{{` / `}}`, or an allowed field
 * with no value is an error and there is NO letter. A client never sees a
 * half-filled one.
 *
 * Deterministic and total: no clock, no randomness, never throws.
 */

export type LetterBlock = {
  /** The bold lead-in, or null. */
  lead: string | null;
  /** The paragraph text. Line breaks inside a value are kept as "\n". */
  text: string;
};

export type RenderError =
  | { kind: "unknown_field"; field: string; sentence: string }
  | { kind: "missing_value"; field: LoeField; sentence: string }
  | { kind: "unclosed"; sentence: string };

export type RenderResult = { ok: true; blocks: LetterBlock[] } | { ok: false; errors: RenderError[] };

const LEAD_IN = /^\*\*([^*]+?)\*\*[ \t]*([\s\S]*)$/;

function mergeText(
  template: string,
  values: LoeValues,
  errors: RenderError[],
  seen: { unknown: Set<string>; missing: Set<string> },
): string {
  // A single replace pass: the replacement text is not re-scanned.
  return template.replace(MERGE_TOKEN, (_all, raw: string) => {
    const name = raw.trim();
    if (!isLoeField(name)) {
      if (!seen.unknown.has(name)) {
        seen.unknown.add(name);
        errors.push({ kind: "unknown_field", field: name, sentence: `The letter uses {{${name}}}, which is not a merge field.` });
      }
      return "";
    }
    const value = values[name];
    if (typeof value !== "string") {
      if (!seen.missing.has(name)) {
        seen.missing.add(name);
        errors.push({ kind: "missing_value", field: name, sentence: `There is no value for {{${name}}}.` });
      }
      return "";
    }
    return value.replace(/\r\n?/g, "\n");
  });
}

export function renderLetter(body: string, values: LoeValues): RenderResult {
  if (typeof body !== "string") return { ok: false, errors: [{ kind: "unclosed", sentence: "The letter has no text." }] };
  const errors: RenderError[] = [];
  const seen = { unknown: new Set<string>(), missing: new Set<string>() };

  const withoutMarkers = body.replace(MERGE_TOKEN, "");
  if (/(\{\{|\}\})/.test(withoutMarkers)) {
    errors.push({ kind: "unclosed", sentence: "The letter has a {{ or }} that does not close." });
  }

  const paragraphs = body
    .replace(/\r\n?/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/^\n+|\n+$/g, ""))
    .filter((p) => p.trim().length > 0);

  const blocks: LetterBlock[] = paragraphs.map((paragraph) => {
    const lead = LEAD_IN.exec(paragraph);
    if (lead) {
      return {
        lead: mergeText(lead[1], values, errors, seen),
        text: mergeText(lead[2], values, errors, seen),
      };
    }
    return { lead: null, text: mergeText(paragraph, values, errors, seen) };
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, blocks };
}

/** The values a signed letter needs, named once so a caller cannot forget one. */
export const REQUIRED_VALUE_FIELDS: readonly LoeField[] = LOE_FIELDS;
