import Link from "next/link";
import { INBOX_MESSAGES, type LiveInboxState } from "@/lib/mailbox/read-message";
import { groupMailByDay, mailTime, type MailRow } from "@/lib/mailbox/my-mail";
import { EmptyState, LoadFailedCard, Notice } from "@/components/ui";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import "./mail-pane.css";

const INTEGRATIONS = "/dashboard/settings/integrations/";

/** The live Inbox tab: the newest 50, read just now, never stored. A failed read is its own sentence, never an empty list. */
export function LiveInboxList({ state, openHref, now, timeZone = DEFAULT_TIME_ZONE }: { state: LiveInboxState; openHref: (messageId: string) => string; now: Date; timeZone?: string }) {
  if (state.status === "failed") {
    return (
      <div className="lx-mail-list">
        <LoadFailedCard what="the inbox" body={INBOX_MESSAGES.failed} />
      </div>
    );
  }
  if (state.status === "reauth") {
    return (
      <div className="lx-mail-list">
        <Notice tone="risk" role="alert">
          {INBOX_MESSAGES.reauth} <Link href={INTEGRATIONS}>Reconnect</Link>
        </Notice>
      </div>
    );
  }
  if (state.status !== "ok") {
    return (
      <div className="lx-mail-list">
        <EmptyState title="No inbox to show">
          {INBOX_MESSAGES[state.status]}
          {state.status === "no-mailbox" && (
            <>
              {" "}
              <Link href={INTEGRATIONS}>Go to Integrations</Link>
            </>
          )}
        </EmptyState>
      </div>
    );
  }
  if (state.rows.length === 0) {
    return (
      <div className="lx-mail-list">
        <EmptyState title="The inbox is empty">We reached {state.mailbox.email} and it has no messages in its inbox.</EmptyState>
      </div>
    );
  }
  const asRows: MailRow[] = state.rows.map((r) => ({ id: r.id, direction: "in", from: r.from, to: [], subject: r.subject, at: r.at ?? "", link: null, connectionId: state.mailbox.id, client: r.client }));
  const byId = new Map(state.rows.map((r) => [r.id, r]));
  const groups = groupMailByDay(asRows.filter((r) => r.at), now, timeZone);
  const undated = asRows.filter((r) => !r.at);
  if (undated.length) groups.push({ key: "undated", label: "No date", rows: undated });
  return (
    <div className="lx-card lx-mail lx-mail-list">
      <p className="lx-note lx-mail-live-note">
        {state.mailbox.email} · {state.rows.length === 1 ? "the newest message" : `the newest ${state.rows.length} messages`}, read just now. Nothing here is saved.
        {state.truncated ? " Older mail is in the mailbox itself." : ""}
      </p>
      {groups.map((g) => (
        <section key={g.key} aria-labelledby={`live-${g.key}`}>
          <h2 id={`live-${g.key}`} className="lx-mail-group">
            {g.label}
          </h2>
          <ul className="lx-list">
            {g.rows.map((r) => {
              const live = byId.get(r.id)!;
              return (
                <li key={r.id} className="lx-mail-live-row">
                  <span className="lx-mail-live-top">
                    <span className="lx-mail-who">{live.from}</span>
                    <span className="lx-num lx-note">{live.at ? mailTime(live.at, now, timeZone) : ""}</span>
                  </span>
                  <span className="lx-mail-subj">
                    <Link href={openHref(live.id)} className="lx-mail-rowlink">
                      {live.subject}
                    </Link>
                    {live.client && (
                      <Link href={live.client.href} className="lx-pill lx-pill-ox lx-mail-tag">
                        {live.client.label}
                      </Link>
                    )}
                  </span>
                  {live.preview && <span className="lx-mail-preview">{live.preview}</span>}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
