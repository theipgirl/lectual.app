import type { QueueLoad } from "@/lib/queue/load";

/**
 * Whenever the queue could not be read — any state that is not `ok`. Never an
 * empty queue. Three messages for three situations (ported verbatim from
 * lectual; its tests come with it).
 */
export type QueueUnavailableState = Pick<QueueLoad, "status" | "reason">;

export function queueUnavailableCopy(state: QueueUnavailableState): { title: string; body: string } {
  if (state.status === "unconfigured" && state.reason === "org-key") {
    return {
      title: "Approvals aren't enabled for this firm yet.",
      body: "Nothing is broken — this firm isn't connected to an approval queue, so there are no drafts to review here. We'll turn it on when the firm's agent workflows go live.",
    };
  }
  if (state.status === "unconfigured") {
    return {
      title: "Approval queue isn't configured for this workspace yet.",
      body: "Ask an admin to set QUEUE_API_URL and DASHBOARD_API_TOKEN for this firm's workspace.",
    };
  }
  return {
    title: "Couldn't reach the approval queue right now.",
    body: "The queue service didn't respond, so we can't tell you what's waiting. This is not the same as nothing waiting — try refreshing in a moment.",
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
