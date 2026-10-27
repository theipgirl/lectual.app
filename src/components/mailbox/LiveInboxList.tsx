import Link from "next/link";
import { INBOX_MESSAGES, type LiveInboxState } from "@/lib/mailbox/read-message";
import { groupMailByDay, mailTime, type MailRow } from "@/lib/mailbox/my-mail";
import "./mail-pane.css";

const INTEGRATIONS = "/dashboard/settings/integrations/";

/** The live Inbox tab: the newest 50, read just now, never stored. A failed read is its own sentence, never an empty list. */
export function LiveInboxList({ state, openHref, now }: { state: LiveInboxState; openHref: (messageId: string) => string; now: Date }) {
  if (state.status !== "ok") {
    return (
      <div className="lx-card lx-empty-card lx-mail-list">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>
          {state.status === "no-mailbox" || state.status === "not-available" ? "No inbox to show" : "The inbox couldn't be read"}
        </h2>
        <p className="lx-note" role={state.status === "failed" || state.status === "reauth" ? "alert" : "status"} style={{ margin: 0 }}>
          {INBOX_MESSAGES[state.status]}
          {(state.status === "reauth" || state.status === "no-mailbox") && (
            <>
              {" "}
              <Link href={INTEGRATIONS}>{state.status === "reauth" ? "Reconnect" : "Go to Integrations"}</Link>
            </>
          )}
        </p>
      </div>
    );
  }
  if (state.rows.length === 0) {
    return (
      <div className="lx-card lx-empty-card lx-mail-list">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>
          The inbox is empty
        </h2>
        <p className="lx-note" style={{ margin: 0 }}>
          We reached {state.mailbox.email} and it has no messages in its inbox.
        </p>
      </div>
    );
  }
  const asRows: MailRow[] = state.rows.map((r) => ({ id: r.id, direction: "in", from: r.from, to: [], subject: r.subject, at: r.at ?? "", link: null, connectionId: state.mailbox.id, client: r.client }));
  const byId = new Map(state.rows.map((r) => [r.id, r]));
  const groups = groupMailByDay(asRows.filter((r) => r.at), now);
  const undated = asRows.filter((r) => !r.at);
  if (undated.length) groups.push({ key: "undated", label: "No date", rows: undated });
  return (
    <div className="lx-card lx-mail lx-mail-list">
      <p className="lx-note" style={{ margin: "10px 0 0" }}>
        {state.mailbox.email} · the newest {state.rows.length} messages, read just now. Nothing here is saved.
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
                    <span className="lx-num lx-note">{live.at ? mailTime(live.at, now) : ""}</span>
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
