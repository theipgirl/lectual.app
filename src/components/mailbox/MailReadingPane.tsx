import Link from "next/link";
import { READ_MESSAGES, type ReadState } from "@/lib/mailbox/read-message";
import { PROVIDER_LABEL } from "@/lib/mailbox/providers";
import "./mail-pane.css";

const INTEGRATIONS = "/dashboard/settings/integrations/";

export function MailPaneLoading() {
  return (
    <section className="lx-card lx-mail-pane" role="status" aria-busy="true" aria-label="Loading the message">
      <p className="lx-note" style={{ margin: 0 }}>
        Loading the message…
      </p>
    </section>
  );
}

/**
 * The message, as plain text. The body is a React text node inside a <pre>, so tags in it are escaped, never
 * rendered, and a link in it is just text: there is no HTML rendering anywhere in this file.
 */
export function MailReadingPane({ state, backHref }: { state: ReadState; backHref: string }) {
  const back = (
    <Link href={backHref} className="lx-btn lx-btn-sec lx-btn-sm lx-mail-back">
      ← Back to the list
    </Link>
  );
  if (state.status !== "ok") {
    return (
      <section className="lx-card lx-mail-pane" aria-label="Message">
        <div className="lx-mail-pane-actions">{back}</div>
        <p className="lx-note" role={state.status === "failed" || state.status === "reauth" ? "alert" : "status"} style={{ margin: 0 }}>
          {READ_MESSAGES[state.status]}
          {state.status === "reauth" && (
            <>
              {" "}
              <Link href={INTEGRATIONS}>Reconnect</Link>
            </>
          )}
        </p>
      </section>
    );
  }
  const { message } = state;
  const when = message.at && Number.isFinite(Date.parse(message.at)) ? new Date(message.at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null;
  return (
    <article className="lx-card lx-mail-pane" aria-label="Message">
      <div className="lx-mail-pane-actions">
        {back}
        {state.openUrl && (
          <a href={state.openUrl} target="_blank" rel="noreferrer noopener" className="lx-note">
            Open in {state.provider === "google" ? "Gmail" : "Outlook"} ↗
          </a>
        )}
      </div>
      <h2 className="lx-mail-subject">{message.subject?.trim() || "(no subject)"}</h2>
      <dl className="lx-mail-head">
        <dt>From</dt>
        <dd>{message.from || "Unknown sender"}</dd>
        <dt>To</dt>
        <dd>{message.to.length > 0 ? message.to.join(", ") : "—"}</dd>
        {message.cc.length > 0 && (
          <>
            <dt>Cc</dt>
            <dd>{message.cc.join(", ")}</dd>
          </>
        )}
        {when && (
          <>
            <dt>Date</dt>
            <dd>{when}</dd>
          </>
        )}
        <dt>Mailbox</dt>
        <dd>
          {PROVIDER_LABEL[state.provider]} · {state.mailbox}
        </dd>
      </dl>
      <pre className="lx-mail-body">{message.body.trim() || "(This message has no text.)"}</pre>
    </article>
  );
}
