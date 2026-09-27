/**
 * "Waiting on the firm": every report view's oldest-items-first list
 * (design/Matters_Prototype.dc.html's `rpAttention`). One shared, pure sort so
 * "oldest first" means the same thing everywhere it appears — a lead waiting
 * longest for a reply, a matter that has sat longest in its stage, an
 * unresolved agent run.
 *
 * Pure: takes already-fetched rows and a key-extractor, so it never needs a
 * database to test.
 */

/** `dateOf` returning null drops the item — an item with no date to sort by
 * cannot honestly be placed "oldest" or "newest". */
export function oldestFirst<T>(
  items: readonly T[],
  dateOf: (item: T) => string | null | undefined,
  limit = 5,
): T[] {
  return items
    .map((item) => ({ item, t: dateOf(item) }))
    .filter((x): x is { item: T; t: string } => x.t != null && !Number.isNaN(Date.parse(x.t)))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t))
    .slice(0, limit)
    .map((x) => x.item);
}

export type WaitingItem = {
  key: string;
  text: string;
  meta: string;
  cta: string;
  href: string;
};

export type LinkTile = {
  label: string;
  sub: string;
  href: string;
  /** null renders no badge at all — never a fabricated 0. */
  count: number | string | null;
};
