import { BUCKET_KEYS, type BucketKey, type ReviewBuckets, type ReviewRow } from "./buckets";
import { BOARD_COLUMNS, laneOf, type LaneMember } from "./lanes";
import { QUEUE_APPROVE_ROLES } from "@/lib/queue/roles";

/**
 * The Cards view: one person's deck, dealt in board order. Pure.
 *
 * The deck is that person's rows from the board grouping (their lane: the next-step assignee, else the
 * record's assignee) in column order (Overdue, This week, Needs a next step, Quiet), plus, for a person in
 * an approver role, every row waiting on approval (any section), without repeating a row.
 */
export type DeckCard = { row: ReviewRow; bucket: BucketKey };

export function canApproveRole(role: string | null | undefined): boolean {
  return !!role && (QUEUE_APPROVE_ROLES as readonly string[]).includes(role);
}

export function buildDeck(buckets: ReviewBuckets, members: readonly LaneMember[], personId: string | null): DeckCard[] {
  if (!personId) return [];
  const deck: DeckCard[] = [];
  const seen = new Set<string>();
  for (const bucket of BOARD_COLUMNS) {
    for (const row of buckets.sections[bucket]) {
      if (laneOf(row) !== personId || seen.has(row.key)) continue;
      seen.add(row.key);
      deck.push({ row, bucket });
    }
  }
  const person = members.find((m) => m.userId === personId);
  if (person && canApproveRole(person.role)) {
    for (const bucket of BUCKET_KEYS) {
      for (const row of buckets.sections[bucket]) {
        if (row.waiting !== "approval" || seen.has(row.key)) continue;
        seen.add(row.key);
        deck.push({ row, bucket });
      }
    }
  }
  return deck;
}

export type DeckPerson = { userId: string; name: string };

/** Every member, owners first, then by name; a lane person who is no longer a member still gets a chip ("Teammate"). */
export function deckPeople(members: readonly LaneMember[], laneIds: readonly (string | null)[] = []): DeckPerson[] {
  const known = new Set(members.map((m) => m.userId));
  const extra = [...new Set(laneIds.filter((id): id is string => !!id && !known.has(id)))].map((userId) => ({ userId, name: "Teammate", role: "" }));
  return [...members, ...extra]
    .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner") || a.name.localeCompare(b.name, "en"))
    .map((m) => ({ userId: m.userId, name: m.name }));
}

/** The person named Rebecca if a member's display name starts with it, else the signed-in user, else the first chip. */
export function defaultPerson(people: readonly DeckPerson[], userId: string | null): string | null {
  const rebecca = people.find((p) => /^rebecca\b/i.test(p.name.trim()));
  if (rebecca) return rebecca.userId;
  if (userId && people.some((p) => p.userId === userId)) return userId;
  return people[0]?.userId ?? null;
}

/** The requested person if they are a chip, else the default. */
export function chosenPerson(people: readonly DeckPerson[], requested: string | null, userId: string | null): string | null {
  if (requested && people.some((p) => p.userId === requested)) return requested;
  return defaultPerson(people, userId);
}
