import type { QueueLoad } from "@/lib/queue/load";
import { notReadyYet } from "@/lib/ui/words";

/**
 * Whenever the queue could not be read — any state that is not `ok`. Never an
 * empty queue. Three messages for three situations, in the glossary's plain words
 * (no setting names; the platform side is Lectual's to switch on).
 */
export type QueueUnavailableState = Pick<QueueLoad, "status" | "reason">;

export function queueUnavailableCopy(state: QueueUnavailableState): { title: string; body: string } {
  if (state.status === "unconfigured" && state.reason === "org-key") {
    return {
      title: "Approvals aren't switched on for your firm yet.",
      body: "Nothing is broken. There are no drafts to review here yet. Lectual will turn this on when your assistants go live.",
    };
  }
  if (state.status === "unconfigured") {
    return {
      title: "Approvals aren't switched on for your firm yet.",
      body: notReadyYet("Approvals"),
    };
  }
  return {
    title: "Can't reach approvals right now.",
    body: "Can't show what's waiting right now. Refresh to try again.",
  };
}

export function QueueUnavailable(props: QueueUnavailableState) {
  const copy = queueUnavailableCopy(props);
  const risk = props.status === "unavailable";
  return (
    <div role={risk ? "alert" : "status"} className={`lx-banner ${risk ? "lx-banner-risk" : "lx-banner-mute"}`}>
      <strong>{copy.title}</strong> {copy.body}
    </div>
  );
}
