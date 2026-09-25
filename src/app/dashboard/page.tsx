import { resolveFirmSession } from "@/lib/firm/session";
import { loadActiveQueue } from "@/lib/queue/load";

/**
 * Today — the empty shell for step 1. It proves the door works end to end:
 * a signed-in member lands inside their own firm (read through RLS) and the
 * queue answers in one of its three states.
 */
export default async function TodayPage() {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") return null; // the layout already handled this
  const queue = await loadActiveQueue();

  const firstName = session.displayName.split(" ")[0];
  const queueLine =
    queue.status === "ok"
      ? queue.items.length === 0
        ? { text: "Nothing waiting for approval.", tone: "lx-pill-ok", pill: "Caught up" }
        : {
            text: `${queue.items.length} draft${queue.items.length === 1 ? "" : "s"} waiting for approval.`,
            tone: "lx-pill-warn",
            pill: "Waiting on you",
          }
      : queue.status === "unavailable"
        ? {
            text: "We couldn't reach the approval queue, so we don't know what's waiting. Check again shortly.",
            tone: "lx-pill-risk",
            pill: "Unreachable",
          }
        : {
            text: "No approval queue is connected for this firm yet.",
            tone: "lx-pill-mute",
            pill: "Not set up",
          };

  return (
    <>
      <div>
        <div className="lx-label">{session.org.name}</div>
        <h1 className="lx-h1">Good to see you, {firstName}.</h1>
        <p className="lx-sub">
          This is the new Lectual workspace. Matters, the queue, mailboxes and agents move in over
          the next build steps; the rail shows where each one will live.
        </p>
      </div>
      <div className="lx-card" style={{ padding: 20, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="lx-label" style={{ marginBottom: 6 }}>
            Approval queue
          </div>
          <div style={{ color: "var(--body)" }}>{queueLine.text}</div>
        </div>
        <span className={`lx-pill ${queueLine.tone}`}>{queueLine.pill}</span>
      </div>
      <div className="lx-upl">
        <span aria-hidden="true">§</span>
        <div>
          <b style={{ color: "var(--ox)" }}>The one rule.</b> Nothing reaches a client without a
          person approving it. Agents draft; the approval queue is the only way out of the firm.
        </div>
      </div>
    </>
  );
}
