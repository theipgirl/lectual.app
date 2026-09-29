/**
 * @-mention parsing for notes (blueprint §13.2).
 *
 * Pure and dependency-free on purpose — no "server-only" import, no
 * getScopedClient — so it can be unit tested without a database and reused
 * by both the server write path (src/lib/pipeline/notes.ts) and the client
 * composer/timeline. Directory membership is passed in by the caller rather
 * than fetched here; this module only ever sees the shape it needs
 * (`userId` + `displayName`), not the full MemberIdentity type from
 * src/lib/members/directory.ts, so it never has to know that type exists.
 *
 * Matching rule (per the spec): case-insensitive, on either the member's
 * whole display name or a UNIQUE first name. Two members named "Dawn" makes
 * "@Dawn" ambiguous — it resolves to nobody rather than guessing, and is
 * rendered as plain text (never highlighted, never notified).
 *
 * The whole-name half is matched against the DIRECTORY, not against a guess
 * at what a name looks like. It used to be a fixed "one or two capitalized
 * words" regex, which silently dropped every tag the picker itself offers
 * outside that shape: "Rebecca P. Beliard" captured only "Rebecca P" and
 * matched nobody, and a member whose display_name came from 0031's
 * `split_part(email,'@',1)` fallback ("support") was never even a candidate.
 * The author saw the picker confirm the tag; the person was never notified.
 * So: try each real display name as a prefix at the "@", longest first.
 */

export type MentionDirectoryMember = {
  userId: string;
  /** null when identity hasn't resolved yet (see directory.ts's degraded path) — never matchable. */
  displayName: string | null;
};

export type ResolvedMentions = {
  /** Deduped, validated recipient ids — the only thing ever written to payload.mentions. */
  userIds: string[];
  /** Raw "@Token" text that matched nobody, or matched more than one member. */
  unresolved: string[];
};

export type MentionSegment =
  | { type: "text"; value: string }
  | { type: "mention"; value: string; userId: string };

// A mention must start at the beginning of the text or right after whitespace
// — NOT right after a letter/digit — so "founder@example.com" never reads as a
// mention of "Example".
const AT_BOUNDARY = /(?:^|(?<=\s))@/g;

// The directory-free fallback, applied only where no display name matches: up
// to two capitalized words. This is what carries the unique-FIRST-name rule
// ("@Dawn" for "Dawn Okafor"), and what names an unresolved "@Ghost" in the
// report. It is a guess at a name's shape and is deliberately conservative —
// anything the picker actually inserts is caught by the directory pass above
// it, which needs no guess at all.
const SHAPED_NAME = /^[A-Z][A-Za-z'-]*(?:\s[A-Z][A-Za-z'-]*)?/;

type NamedMember = MentionDirectoryMember & { displayName: string };

function namedMembers(directory: readonly MentionDirectoryMember[]): NamedMember[] {
  return directory.filter((m): m is NamedMember => Boolean(m.displayName && m.displayName.trim()));
}

/**
 * The longest display name in `directory` that the text spells out starting at
 * `at` (the index just past the "@"), case-insensitively.
 *
 * `userId` is null when two members share that display name — ambiguous, and
 * ambiguity resolves to nobody rather than to a guess, same as a first name.
 * The returned `name` is the slice AS TYPED, so the token reported back to the
 * caller quotes the note rather than the directory.
 */
function directoryMatchAt(
  text: string,
  at: number,
  members: readonly NamedMember[],
): { name: string; userId: string | null } | null {
  let bestLength = 0;
  const matched: string[] = [];

  for (const member of members) {
    const name = member.displayName.trim();
    if (name.length < bestLength) continue;
    const slice = text.slice(at, at + name.length);
    if (slice.length !== name.length) continue;
    if (slice.toLowerCase() !== name.toLowerCase()) continue;
    // The name must END at a boundary too, so a directory "Dawn" is not read
    // out of "@Dawnisha".
    const next = text[at + name.length];
    if (next !== undefined && /[A-Za-z0-9]/.test(next)) continue;

    if (name.length > bestLength) {
      bestLength = name.length;
      matched.length = 0;
    }
    matched.push(member.userId);
  }

  if (bestLength === 0) return null;
  return {
    name: text.slice(at, at + bestLength),
    userId: matched.length === 1 ? matched[0] : null,
  };
}

function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/, 1)[0] ?? displayName;
}

/**
 * The directory-free fallback for a candidate no display name matched.
 *
 * Returns the single matching member's userId, or null when the candidate
 * matches zero members (unknown) or more than one (ambiguous) — both are
 * "unresolved" to the caller, which is exactly what the spec asks for.
 */
function matchShaped(name: string, members: readonly NamedMember[]): string | null {
  const needle = name.trim().toLowerCase();

  // A two-word candidate that didn't match a whole display name (e.g. "Dawn
  // Chen" when the org has no such person) has no business matching on "Dawn"
  // alone — the second word was typed on purpose.
  if (needle.includes(" ")) return null;

  const firstNameMatches = members.filter((m) => firstName(m.displayName).toLowerCase() === needle);
  return firstNameMatches.length === 1 ? firstNameMatches[0].userId : null;
}

type Candidate = { token: string; userId: string | null; start: number; end: number };

/**
 * Every "@…" in `text`, left to right, each already resolved against the
 * directory. A candidate with a null `userId` is unknown or ambiguous.
 */
function scan(text: string, directory: readonly MentionDirectoryMember[]): Candidate[] {
  const members = namedMembers(directory);
  const candidates: Candidate[] = [];

  for (const match of text.matchAll(AT_BOUNDARY)) {
    if (match.index === undefined) continue;
    const start = match.index;
    const at = start + 1;

    const direct = directoryMatchAt(text, at, members);
    if (direct) {
      candidates.push({
        token: `@${direct.name}`,
        userId: direct.userId,
        start,
        end: at + direct.name.length,
      });
      continue;
    }

    const shaped = SHAPED_NAME.exec(text.slice(at));
    if (!shaped) continue;
    const name = shaped[0];
    candidates.push({
      token: `@${name}`,
      userId: matchShaped(name, members),
      start,
      end: at + name.length,
    });
  }

  return candidates;
}

// The pre-directory candidate shape, kept for `extractMentionCandidates` —
// which has no directory to match against and reports only what LOOKS like a
// mention.
const MENTION_PATTERN = /(?:^|(?<=\s))@([A-Z][A-Za-z'-]*(?:\s[A-Z][A-Za-z'-]*)?)/g;

/**
 * The raw "@Name" tokens found in `text`, left to right, untouched by any
 * directory.
 *
 * Shape-based and therefore approximate: with no directory it cannot know that
 * "@Rebecca P. Beliard" is one name. Resolution never goes through here — use
 * `resolveMentions`, which matches real display names.
 */
export function extractMentionCandidates(text: string): string[] {
  const tokens: string[] = [];
  for (const match of text.matchAll(MENTION_PATTERN)) tokens.push(match[0]);
  return tokens;
}

/** Resolves every @-candidate in `text` against `directory`. Never throws. */
export function resolveMentions(
  text: string,
  directory: readonly MentionDirectoryMember[],
): ResolvedMentions {
  const userIds = new Set<string>();
  const unresolved: string[] = [];

  for (const candidate of scan(text, directory)) {
    if (candidate.userId) userIds.add(candidate.userId);
    else unresolved.push(candidate.token);
  }

  return { userIds: [...userIds], unresolved };
}

/**
 * Splits `text` into plain-text and mention segments for highlighting.
 * Only candidates that resolve to exactly one member become `mention`
 * segments; an unresolved (unknown or ambiguous) "@Token" is left inside a
 * surrounding `text` segment, indistinguishable from ordinary prose — the
 * spec's "shown as plain text".
 */
export function renderSegments(
  text: string,
  directory: readonly MentionDirectoryMember[],
): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let cursor = 0;

  for (const candidate of scan(text, directory)) {
    if (!candidate.userId) continue; // stays plain text, folded into the next/trailing segment

    if (candidate.start > cursor) {
      segments.push({ type: "text", value: text.slice(cursor, candidate.start) });
    }
    segments.push({ type: "mention", value: candidate.token, userId: candidate.userId });
    cursor = candidate.end;
  }

  if (cursor < text.length) {
    segments.push({ type: "text", value: text.slice(cursor) });
  }

  // A note with no mentions at all still renders — one text segment, same as
  // if this function had never been called.
  if (segments.length === 0) segments.push({ type: "text", value: text });

  return segments;
}
