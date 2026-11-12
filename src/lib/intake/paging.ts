/**
 * Paging for the Leads page. PURE. The list shows a page at a time; the page size lives in the URL (`?show=`) so Copy link
 * and Back keep it. Sort runs BEFORE the slice, and every number ("Showing N of M", chip counts) is over the whole
 * filtered set, never the page. A board column shows a few cards and "Show more".
 */
export const SHOW_STEP = 25;
export const SHOW_MAX = 2000;
export const BOARD_COLUMN_CAP = 15;

/** `?show=` to a page size: a positive whole number, rounded UP to a step, at most SHOW_MAX; anything else is one step. */
export function parseShow(raw: string | null | undefined): number {
  const n = Number(String(raw ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return SHOW_STEP;
  return Math.min(SHOW_MAX, Math.ceil(n / SHOW_STEP) * SHOW_STEP);
}

export type Slice<T> = { shown: T[]; total: number; left: number };

/** The first `show` of an ALREADY SORTED list, and how many are left. */
export function pageSlice<T>(sorted: readonly T[], show: number): Slice<T> {
  const shown = sorted.slice(0, Math.max(0, show));
  return { shown, total: sorted.length, left: sorted.length - shown.length };
}

/** The next page size. */
export function nextShow(show: number): number {
  return Math.min(SHOW_MAX, show + SHOW_STEP);
}

/**
 * One board column's cards: cards moved in this session (`pinned`, most recent first) are listed first and do not count
 * against the cap, so a card dropped into a full column never seems to vanish; then the rest, up to `cap`.
 * `left` counts what is hidden.
 */
export function capColumn<T extends { lead: { id: string } }>(rows: readonly T[], cap: number, pinned: readonly string[] = []): { shown: T[]; left: number } {
  const byId = new Map(rows.map((r) => [r.lead.id, r]));
  const pinnedRows = pinned.map((id) => byId.get(id)).filter((r): r is T => !!r);
  const pinnedSet = new Set(pinnedRows.map((r) => r.lead.id));
  const rest = rows.filter((r) => !pinnedSet.has(r.lead.id));
  const room = Math.max(0, cap);
  return { shown: [...pinnedRows, ...rest.slice(0, room)], left: Math.max(0, rest.length - room) };
}
