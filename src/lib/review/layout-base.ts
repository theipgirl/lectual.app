import { laneKey, UNASSIGNED_LANE_KEY } from "./board-layout";
import { layoutKeyOf } from "./layout";
import { NOTES_PRESENT, columnsFor, type CustomColumnField, type SheetSectionId } from "./sheet-columns";
import { UNASSIGNED_LANE } from "./lanes";
import type { LayoutDefault } from "@/lib/views/layout/types";

/**
 * The columns an OWNER'S layout change starts from, as `LayoutDefault`s (the server builds them itself; the browser never sends a layout).
 * Pure. One base per List SECTION: the Weekly review keeps one layout for Trademarks and one for Contracts.
 */
/** Every column the owner may have in one section (the owner sees fees and the firm's Money columns), in default order. */
export function reviewListBase(fields: readonly CustomColumnField[], section: SheetSectionId): LayoutDefault[] {
  return columnsFor(section, { canSeeMoney: true, canSeeCustomMoney: true, hasNotes: NOTES_PRESENT, customFields: fields }).map((c): LayoutDefault => ({ key: layoutKeyOf(c.id), label: c.header, pinned: c.pinned }));
}

export type BoardMember = { userId: string; name: string; role: string };

/**
 * Every person's lane the Weekly review Board could draw, in the Board's own default order (owners first, then alphabetical, Unassigned
 * last): the base for a Board layout change, so a person with no cards today keeps their saved place.
 */
export function reviewBoardBase(members: readonly BoardMember[]): LayoutDefault[] {
  const sorted = [...members].sort((a, b) => (a.role === "owner" ? 0 : 1) - (b.role === "owner" ? 0 : 1) || a.name.localeCompare(b.name, "en"));
  return [...sorted.map((m): LayoutDefault => ({ key: laneKey(m.userId), label: m.name })), { key: UNASSIGNED_LANE_KEY, label: UNASSIGNED_LANE }];
}
