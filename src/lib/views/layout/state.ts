import { VIEW_LAYOUT_UNAVAILABLE } from "@/lib/ui/words";
import type { Layout } from "./types";

/** What a read of a saved layout said (the read itself is `load.ts`, server only). Pure, so a page and its tests share the rules. */
export type LayoutRead = { status: "ok"; layout: Layout | null; rev: number | null } | { status: "not-set-up" } | { status: "unavailable" };

/**
 * The layout to APPLY: the saved one for an `ok` read with a row, else null (the standard columns). A read that wasn't ok, or an absent one
 * (a page that didn't ask), draws the standard layout too: never an empty table.
 */
export function savedLayoutOf(read: LayoutRead | null | undefined): Layout | null {
  return read && read.status === "ok" ? read.layout : null;
}

/** The one quiet sentence, only for a read that FAILED. "Not set up yet" says nothing (the standard layout is simply the layout). */
export function layoutNote(read: LayoutRead | null | undefined): string | null {
  return read && read.status === "unavailable" ? VIEW_LAYOUT_UNAVAILABLE : null;
}
