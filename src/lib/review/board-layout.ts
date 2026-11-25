import { applyLayout } from "@/lib/views/layout/apply";
import type { Layout } from "@/lib/views/layout/types";
import type { Lane } from "./lanes";

/**
 * The Weekly review Board's columns are people (the lanes), so a firm's `review_board` layout orders and names PEOPLE. A lane's layout key
 * is `u` and the member's id without its dashes (33 characters, so inside the 40 a layout key may have), or `unassigned`. A person who
 * is not in the saved layout (someone new) comes after the saved ones, visible; a saved person who has no cards today simply has no lane.
 * Pure.
 */
export const UNASSIGNED_LANE_KEY = "unassigned";

export function laneKey(userId: string | null): string {
  return userId ? `u${userId.replace(/-/g, "").toLowerCase()}` : UNASSIGNED_LANE_KEY;
}

export type DrawnLane = Lane & {
  /** The lane's key in a layout. */
  key: string;
  /** The heading: the person's name, or the firm's own label for the column. */
  title: string;
};

/**
 * The lanes to draw, in the firm's saved order, with its labels. `hidden` counts the people's lanes the layout hides (`hiddenUnassigned` says whether Unassigned is hidden): the page says so once, so a
 * person's records are never silently out of the Board. With no saved layout: the lanes as they are (`boardLanes`' own order).
 */
export function applyBoardLayout(lanes: readonly Lane[], saved: Layout | null | undefined): { lanes: DrawnLane[]; /** Hidden people's lanes (not Unassigned). */ hidden: number; /** The Unassigned lane is hidden. */ hiddenUnassigned: boolean; /** Every hidden lane (Unassigned included), for an owner's "Hidden columns" control. */ hiddenLanes: { key: string; label: string }[] } {
  const defaults = lanes.map((lane) => ({ key: laneKey(lane.userId), label: lane.name, lane }));
  const drawn = applyLayout(defaults, saved).map(({ lane, label, key }): DrawnLane => ({ ...lane, key, title: label }));
  const shown = new Set(drawn.map((l) => l.key));
  const missing = lanes.filter((l) => !shown.has(laneKey(l.userId)));
  const labelOf = (lane: Lane) => saved?.find((c) => c.key === laneKey(lane.userId))?.label ?? lane.name;
  return {
    lanes: drawn,
    hidden: missing.filter((l) => l.userId !== null).length,
    hiddenUnassigned: missing.some((l) => l.userId === null),
    hiddenLanes: missing.map((l) => ({ key: laneKey(l.userId), label: labelOf(l) })),
  };
}
