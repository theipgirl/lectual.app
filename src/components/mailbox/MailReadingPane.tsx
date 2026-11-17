import Link from "next/link";
import { READ_MESSAGES, type ReadState } from "@/lib/mailbox/read-message";
import { PROVIDER_LABEL } from "@/lib/mailbox/providers";
import { BackLink } from "@/components/ui/PageHeader";
import { formatDayTime } from "@/lib/ui/dates";
import { DEFAULT_TIME_ZONE } from "@/lib/org/profile-rules";
import { BLANK, LOADING, MAIL_NAME } from "@/lib/ui/words";
import "./mail-pane.css";

const INTEGRATIONS = "/dashboard/settings/integrations/";

export function MailPaneLoading() {
  return (
    <section className="lx-card lx-mail-pane" role="status" aria-busy="true" aria-label="Loading the message">
      <p className="lx-note">{LOADING}</p>
    </section>
  );
}

/**
 * The message, as plain text. The body is a React text node inside a <pre>, so tags in it are escaped, never
 * rendered, and a link in it is just text: there is no HTML rendering anywhere in this file.
 */
export function MailReadingPane({ state, backHref, timeZone = DEFAULT_TIME_ZONE, listLabel = MAIL_NAME }: { state: ReadState; backHref: string; timeZone?: string; listLabel?: string }) {
  const back = <BackLink href={backHref} label={listLabel} />;
  if (state.status !== "ok") {
    return (
      <section className="lx-card lx-mail-pane" aria-label="Message">
        <div className="lx-mail-pane-actions">{back}</div>
        <p className="lx-note" role={state.status === "failed" || state.status === "reauth" ? "alert" : "status"}>
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
  const when = message.at ? formatDayTime(message.at, { tz: timeZone }) : null;
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
      <h2 className="lx-h2 lx-mail-subject">{message.subject?.trim() || "(no subject)"}</h2>
      <dl className="lx-mail-head">
        <dt>From</dt>
        <dd>{message.from || "Unknown sender"}</dd>
        <dt>To</dt>
        <dd>{message.to.length > 0 ? message.to.join(", ") : BLANK}</dd>
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
