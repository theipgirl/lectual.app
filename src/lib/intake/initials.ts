/**
 * The ONE rule for reading a set of staff initials out of this firm's records
 * (blueprint §12.3).
 *
 * The spreadsheet's notes are an append-only log written in initials — "DO sent
 * post-consult email 8.3.26", "RL prelim search 7.1.26" — and §12.2's email sync
 * attributes a sender the same way. Both used to answer "who is DO?" in their
 * own file. They now ask here, so a correction (a new hire, a role mailbox
 * changing hands, a set of initials turning out to be ambiguous) lands once.
 *
 * Pure: no getScopedClient, no server-only import, no `@/lib` side effects. It
 * is imported by the sheet planner, by the /intake surfaces and — by relative
 * path — by the hand-run scripts under scripts/.
 */

/** The slice of the org roster this rule needs. Structurally satisfied by MemberIdentity. */
export type InitialsDirectoryMember = {
  userId: string;
  displayName: string | null;
};

/**
 * Four outcomes, not two.
 *
 * `ambiguous` and `former` are deliberately NOT folded into `unknown`: an
 * operator reading "unknown initials: MJ" goes looking for a person who left in
 * 2025, and one reading "unknown initials: TM" goes looking for a person when
 * the real answer is that the token means two different things. Each needs its
 * own sentence in the report, so each gets its own outcome here.
 */
export type InitialsResolution =
  | { userId: string }
  | { ambiguous: true }
  | { former: true }
  | { unknown: true };

/**
 * Initials the roster can never derive, mapped to the display name they mean.
 *
 * The sheet logs "TAM" for someone whose Lectual display name is "Taylor
 * McGhee" (TM) — a middle initial that exists in her signature and not in her
 * profile. An alias is a named, auditable exception rather than a fuzzy
 * first-and-last-letter fallback: the fallback also made "TM" resolve to her,
 * which §12.3 says it must never do.
 */
export const INITIALS_ALIASES: Readonly<Record<string, string>> = {
  TAM: "Taylor McGhee",
};

/**
 * Initials that are never a person, however few people share them.
 *
 * "TM" usually means Taylor — and also means *Trademark* ("TM follow up
 * 9.9.26", 24 entries in the 2026-09 export). There is no way to tell the two
 * apart from the token, so this one is reported for a human every time, even
 * when exactly one member of the firm has those initials. Guessing here puts a
 * lead on somebody's Monday list because a note said "trademark".
 */
export const AMBIGUOUS_INITIALS: readonly string[] = ["TM"];

/**
 * People who worked these matters and have since left (confirmed by Taylor
 * 2026-09-14).
 *
 * Their touches are real history and keep their initials on the timeline, so
 * this is NOT a blocklist — it is the difference between "nobody knows who this
 * is" and "we know exactly who this is, and they no longer work here". They
 * never become a lead's owner, and they are never reported as unknown.
 */
export const FORMER_STAFF_INITIALS: readonly string[] = ["MJ", "DL", "TL", "RN"];

/** Upper-cased, punctuation-free token — "do." and " do " are both DO. */
export function normalizeInitials(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^\p{L}]+/gu, "").toUpperCase();
}

/**
 * The initials of a display name: the first letter of every name token.
 * "Rayn Lathome" → RL, "Taylor McGhee" → TM, "Taylor A. McGhee" → TAM.
 *
 * Diacritics fold first, so "Renée Dubois" is RD and not R?D.
 */
export function initialsFor(displayName: string | null | undefined): string {
  const tokens = (displayName ?? "")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\s'-]+/gu, " ")
    .split(/\s+/)
    // A token must START with a letter: the export contains cells that are all
    // punctuation ("---"), and "-" is not anybody's initial.
    .filter((t) => /^\p{L}/u.test(t));
  return tokens.map((t) => t[0].toUpperCase()).join("");
}

/** Comparison form for an alias's display name — diacritic- and case-insensitive. */
function normalizeName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\s'-]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Resolve a set of initials against the org's roster.
 *
 * Order is load-bearing. Former staff and the always-ambiguous list are
 * answered from the tables BEFORE the roster is consulted, because both are
 * facts about the token itself: a firm that later hires a "Tomás Marín" must
 * not thereby start assigning every "TM follow up" note to him.
 *
 * Matching is by `initialsFor(member.displayName)` or by an alias's display
 * name. Two members matching is ambiguous, not a coin toss — §5 rule 6 says an
 * unresolved owner is reported and `assigned_to` stays null.
 */
export function resolveInitials(
  initials: string | null | undefined,
  directory: readonly InitialsDirectoryMember[],
): InitialsResolution {
  const wanted = normalizeInitials(initials);
  if (!wanted) return { unknown: true };
  if (FORMER_STAFF_INITIALS.includes(wanted)) return { former: true };
  if (AMBIGUOUS_INITIALS.includes(wanted)) return { ambiguous: true };

  const aliasName = INITIALS_ALIASES[wanted] ? normalizeName(INITIALS_ALIASES[wanted]) : null;

  const matchedIds = new Set<string>();
  for (const member of directory) {
    const displayName = member.displayName?.trim();
    if (!displayName) continue;
    if (initialsFor(displayName) === wanted || (aliasName !== null && normalizeName(displayName) === aliasName)) {
      matchedIds.add(member.userId);
    }
  }

  if (matchedIds.size === 1) return { userId: [...matchedIds][0] };
  if (matchedIds.size > 1) return { ambiguous: true };
  return { unknown: true };
}

/** Narrowing helper — `"userId" in result` reads poorly at every call site. */
export function resolvedUserId(result: InitialsResolution): string | null {
  return "userId" in result ? result.userId : null;
}

/** The report bucket a resolution belongs in. */
export type InitialsReason = "ambiguous" | "former" | "unknown";

export function initialsReason(result: InitialsResolution): InitialsReason | null {
  if ("userId" in result) return null;
  if ("ambiguous" in result) return "ambiguous";
  if ("former" in result) return "former";
  return "unknown";
}
