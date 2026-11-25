import { laneKey, UNASSIGNED_LANE_KEY } from "./board-layout";
import { layoutKeyOf } from "./layout";
import { NOTES_PRESENT, SHEET_SECTIONS, columnsFor, type CustomColumnField } from "./sheet-columns";
import { UNASSIGNED_LANE } from "./lanes";
import type { LayoutDefault } from "@/lib/views/layout/types";

/**
 * The columns an OWNER'S layout change starts from, as `LayoutDefault`s (the server builds them itself; the browser never sends a layout).
 * Pure.
 *
 * The Weekly review's two sections (Trademarks and Contracts) share ONE saved List layout, so the base is both sections' columns merged:
 * the Trademarks order, with each Contracts-only column placed after the column that precedes it in Contracts. A layout key a section
 * doesn't draw is ignored by that section (`applyReviewLayout`), so the merge changes nothing on screen until a firm saves.
 */
export function mergeDefaults(a: readonly LayoutDefault[], b: readonly LayoutDefault[]): LayoutDefault[] {
  const out = [...a];
  b.forEach((d, i) => {
    if (out.some((x) => x.key === d.key)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex((x) => x.key === b[j].key);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, d);
  });
  return out;
}

/** Every column the owner may have on the Weekly review List (the owner sees fees and the firm's Money columns), in merged default order. */
export function reviewListBase(fields: readonly CustomColumnField[]): LayoutDefault[] {
  const perSection = SHEET_SECTIONS.map((section) =>
    columnsFor(section, { canSeeMoney: true, canSeeCustomMoney: true, hasNotes: NOTES_PRESENT, customFields: fields }).map((c): LayoutDefault => ({ key: layoutKeyOf(c.id), label: c.header, pinned: c.pinned })),
  );
  return perSection.reduce<LayoutDefault[]>((all, next) => mergeDefaults(all, next), []);
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
