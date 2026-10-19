/**
 * Pure rendering helpers for the client proposal page. No React, no Next, no
 * database: safe to unit-test in plain node.
 *
 * Nothing here produces HTML. Firm and client text is only ever handed to React
 * as text; the one piece of markup the firm may write, `**bold**`, is parsed
 * into segments and each segment is rendered as a text node (inside a <b>
 * element React creates itself). A `<script>` in a note is therefore shown as
 * the characters it is made of.
 */

/** Whole dollars when the amount is whole ("$4,950"), else cents ("$4,950.50"). Negative uses a real minus. */
export function money(cents: number): string {
  const n = typeof cents === "number" && Number.isFinite(cents) ? Math.round(cents) : 0;
  const abs = Math.abs(n);
  const dollars = Math.floor(abs / 100);
  const rest = abs % 100;
  const body = dollars.toLocaleString("en-US") + (rest ? "." + String(rest).padStart(2, "0") : "");
  return (n < 0 ? "−$" : "$") + body;
}

export type RichSegment = { bold: boolean; text: string };

/**
 * `**bold**` is the only markup. Anything else, including angle brackets,
 * ampersands and lone asterisks, stays literal text. An unmatched `**` is text.
 */
export function richSegments(input: unknown): RichSegment[] {
  const text = typeof input === "string" ? input : "";
  const out: RichSegment[] = [];
  for (const part of text.split(/(\*\*[^*]+\*\*)/)) {
    if (!part) continue;
    if (part.length > 4 && part.startsWith("**") && part.endsWith("**")) {
      out.push({ bold: true, text: part.slice(2, -2) });
    } else {
      out.push({ bold: false, text: part });
    }
  }
  return out;
}

/** Blank-line separated paragraphs, trimmed, empties dropped. */
export function paragraphs(input: unknown): string[] {
  if (typeof input !== "string") return [];
  return input
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** "2026-10-26" -> "Monday, October 26, 2026". Calendar arithmetic only, so no time zone can move the day. */
export function formatCivilDate(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** The URL back if it is a well-formed https URL, else null. A `javascript:` or `http:` link is never followed. */
export function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Which look a firm gets. Only RPB has a bespoke brand; everyone else is neutral. */
export type ProposalBrand = "rpb" | "neutral";

export function brandForSlug(slug: string | null | undefined): ProposalBrand {
  return slug === "rpb-law" ? "rpb" : "neutral";
}
