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
 * The lanes to draw, in the firm's saved order, with its labels. `hidden` counts the lanes the layout hides: the page says so once, so a
 * person's records are never silently out of the Board. With no saved layout: the lanes as they are (`boardLanes`' own order).
 */
export function applyBoardLayout(lanes: readonly Lane[], saved: Layout | null | undefined): { lanes: DrawnLane[]; hidden: number } {
  const defaults = lanes.map((lane) => ({ key: laneKey(lane.userId), label: lane.name, lane }));
  const drawn = applyLayout(defaults, saved).map(({ lane, label, key }): DrawnLane => ({ ...lane, key, title: label }));
  return { lanes: drawn, hidden: lanes.length - drawn.length };
}
