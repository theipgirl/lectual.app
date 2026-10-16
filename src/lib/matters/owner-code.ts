/**
 * Pure staff-owner display mapping — no database, no server-only imports, safe
 * to import from a `"use client"` component. Same discipline as stage-rules.ts:
 * anything the board/table renders in the browser has to be reachable there.
 *
 * "Whose court is it in" is the exact phrase from the Aug 19 RPB Law team
 * transcript. RPB's own shorthand for it — used in the shared spreadsheet
 * today — is a short code per teammate: TAM (Taylor), C (Caitlyn), RL (Rain),
 * DO (Dawn), AM (Amore), RB (Rebecca). That convention is RPB's, not a
 * platform rule, so it is kept as a small override table rather than baked
 * into the algorithm — a firm whose team isn't RPB (e.g. Hartwell IP) still
 * gets a sensible code, just a computed one instead of a memorized one.
 */

/** Firm-specific shorthand, keyed by the lowercased first token of a name or
 *  email local-part. Extend this table per firm if another one wants the same
 *  "memorized code" treatment; everyone else falls through to computeInitials. */
const KNOWN_CODES: Record<string, string> = {
  taylor: "TAM",
  caitlyn: "C",
  caitlin: "C",
  rain: "RL",
  dawn: "DO",
  amore: "AM",
  rebecca: "RB",
};

/** First "word" of a name or the local-part of an email, lowercased, with
 *  common separators (@, ., _, +, digits) treated as a boundary — so
 *  "dawn@rpblawfirm.com" and "Dawn Alvarez" resolve the same lookup key. */
function firstToken(value: string): string {
  const cleaned = value.trim().toLowerCase();
  const bySpace = cleaned.split(/\s+/)[0] ?? cleaned;
  const byPunct = bySpace.split(/[@._+0-9]/)[0] ?? bySpace;
  return byPunct;
}

/**
 * Computed fallback for anyone not in KNOWN_CODES: first letter of each
 * whitespace-separated token, up to 3, uppercased ("Rebecca Beliard" → "RB",
 * "Dawn" → "DA"). Never returns an empty string for non-empty input.
 */
export function computeInitials(displayName: string): string {
  const tokens = displayName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return "?";
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return tokens
    .slice(0, 3)
    .map((t) => t[0]!.toUpperCase())
    .join("");
}

export type OwnerChip = {
  userId: string;
  /** Short chip text — RPB's convention when known, else computed initials. */
  code: string;
  /** Full name/email for the tooltip — never guess, always the real identity. */
  label: string;
};

/**
 * Resolves a member identity into the chip the docket renders. Returns null
 * for an unassigned matter/lead — callers render "Unassigned", never a blank
 * chip that could be mistaken for a real code.
 */
export function ownerChipFor(
  identity: { userId: string; displayName: string | null; email: string | null } | null,
): OwnerChip | null {
  if (!identity) return null;
  const label = identity.displayName?.trim() || identity.email?.trim() || identity.userId;
  const key = firstToken(identity.displayName?.trim() || identity.email?.trim() || "");
  const code = (key && KNOWN_CODES[key]) || computeInitials(label);
  return { userId: identity.userId, code, label };
}
