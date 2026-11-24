import type { QueueItem } from "@/lib/queue/api";
import { DONE_NOTE } from "@/lib/ui/words";

/**
 * "Done" is a card handled without approving. The queue has no such status, so it is a reject whose resolve note is the
 * ONE marker (`DONE_NOTE`). Every surface that tells a person how a card ended reads it through here, so none says
 * "Rejected" for a Done card. Pure.
 */

/** The deck appends "Receipt: sha256 <hex>" lines to some notes; they never change what the outcome is. */
function bare(note: string | null | undefined): string {
  return (note ?? "")
    .split(/\r?\n/)
    .filter((l) => !/^\s*Receipt:\s*sha256\s+[0-9a-f]{6,64}\s*$/i.test(l))
    .join(" ")
    .trim();
}

/** True when this resolve note is exactly the Done marker. A person's own reject note is never Done. */
export const isDoneNote = (note: string | null | undefined): boolean => bare(note) === DONE_NOTE;

/** A rejected item whose note is the marker. */
export const isDoneItem = (item: Pick<QueueItem, "status" | "resolution_note">): boolean => item.status === "rejected" && isDoneNote(item.resolution_note);

export type Outcome = "approved" | "rejected" | "done";

/** How a RESOLVED item ended (null while pending). */
export function outcomeOf(item: Pick<QueueItem, "status" | "resolution_note">): Outcome | null {
  if (item.status === "approved") return "approved";
  if (item.status !== "rejected") return null;
  return isDoneItem(item) ? "done" : "rejected";
}

