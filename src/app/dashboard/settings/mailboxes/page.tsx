import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { canManageScope } from "@/lib/mailbox/access";
import { connectableProviders } from "@/lib/mailbox/config";
import { listConnections, type MailboxConnection } from "@/lib/mailbox/connections";
import { outcomeMessage } from "@/lib/mailbox/outcome";
import { PROVIDER_LABEL, PROVIDERS, isProvider, type MailboxProvider } from "@/lib/mailbox/providers";
import { relativeTime } from "@/lib/relative-time";
import { ProviderMark } from "@/components/mailbox/ProviderMark";
import { DisconnectButton } from "@/components/mailbox/DisconnectButton";

const STATUS: Record<MailboxConnection["status"], { label: string; tone: string }> = {
  active: { label: "Syncing", tone: "lx-pill-ok" },
  reauth: { label: "Reconnect", tone: "lx-pill-risk" },
  error: { label: "Sync failing", tone: "lx-pill-warn" },
  revoked: { label: "Disconnected", tone: "lx-pill-mute" },
};

function connectHref(provider: MailboxProvider, scope: "personal" | "firm") {
  return `/api/mailbox/connect/${provider}/?scope=${scope}`;
}

function ConnectButton(props: {
  provider: MailboxProvider;
  scope: "personal" | "firm";
  enabled: boolean;
  label: string;
}) {
  const inner = (
    <>
      <ProviderMark provider={props.provider} />
      {props.label}
    </>
  );
  // A plain link, not a fetch: the flow is a series of top-level redirects.
  return props.enabled ? (
    <a href={connectHref(props.provider, props.scope)} className="lx-btn lx-btn-sec lx-btn-sm">
      {inner}
    </a>
  ) : (
    <span
      className="lx-btn lx-btn-sec lx-btn-sm"
      aria-disabled="true"
      title={`${PROVIDER_LABEL[props.provider]} isn't set up on this deployment yet`}
      style={{ opacity: 0.5, cursor: "not-allowed" }}
    >
      {inner}
    </span>
  );
}

function MailboxRow({ c, canManage }: { c: MailboxConnection; canManage: boolean }) {
  const status = STATUS[c.status];
  return (
    <div className="lx-mbx">
      <div className="lx-prov">
        <ProviderMark provider={c.provider} />
      </div>
      <div className="lx-mbx-main">
        <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{c.email}</div>
        <div className="lx-note">
          {PROVIDER_LABEL[c.provider]} · {c.scope === "personal" ? "My mailbox" : "Shared"} · since{" "}
          {new Date(c.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </div>
        {c.status !== "active" && c.last_error && (
          <div className="lx-note" style={{ color: "var(--wine)" }}>
            {c.last_error}
          </div>
        )}
      </div>
      <div className="lx-mbx-count">
        <div className="lx-num">{c.matched_count}</div>
        <div className="lx-note">matched to clients</div>
      </div>
      <div style={{ textAlign: "right", minWidth: 92 }}>
        <span className={`lx-pill ${status.tone}`}>{status.label}</span>
        <div className="lx-note" style={{ marginTop: 4 }}>
          {c.last_synced_at ? relativeTime(c.last_synced_at) : "first sync pending"}
        </div>
      </div>
      {canManage && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {c.status === "reauth" && (
            <a href={connectHref(c.provider, c.scope)} className="lx-btn lx-btn-pri lx-btn-sm">
              Reconnect
            </a>
          )}
          <DisconnectButton id={c.id} email={c.email} />
        </div>
      )}
    </div>
  );
}

export default async function MailboxesPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; reconnected?: string; error?: string }>;
}) {
  if (!(await orgHasModule("mailbox"))) notFound();
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();

  const { connected, reconnected, error } = await searchParams;
  const list = await listConnections();
  const connectable = connectableProviders();
  const canManageFirm = canManageScope(session.role, "firm");

  const mine = list.ok ? list.connections.filter((c) => c.scope === "personal") : [];
  const firm = list.ok ? list.connections.filter((c) => c.scope === "firm") : [];
  const errorText = outcomeMessage(error);
  const nothingConfigured = !connectable.google && !connectable.microsoft;

  return (
    <>
      <div>
        <div className="lx-label">Settings</div>
        <h1 className="lx-h1">Mailboxes</h1>
        <p className="lx-sub">
          Connect Gmail or Outlook so Lectual can match client email to the right lead or matter,
          keep &ldquo;last heard from&rdquo; current, and let the intel agent fill in what&apos;s
          missing. Mail from people who aren&apos;t clients is never stored.
        </p>
      </div>

      {connected && isProvider(connected) && (
        <div role="status" className="lx-banner lx-banner-ok">
          {PROVIDER_LABEL[connected]} {reconnected ? "reconnected" : "connected"}. The first sync
          will pull the last 30 days.
        </div>
      )}
      {errorText && (
        <div role="alert" className="lx-banner lx-banner-risk">
          {errorText}
        </div>
      )}
      {!list.ok && (
        <div role="alert" className="lx-banner lx-banner-risk">
          We couldn&apos;t load your mailbox connections, so this list may be incomplete. Try again
          shortly.
        </div>
      )}
      {nothingConfigured && (
        <div className="lx-banner lx-banner-mute">
          Mailbox connections aren&apos;t set up on this deployment yet. An administrator needs to
          add the Google and Microsoft sign-in credentials.
        </div>
      )}

      <section className="lx-card">
        <div className="lx-card-head">
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 className="lx-h2" style={{ fontSize: 23 }}>
              My mailbox
            </h2>
            <div className="lx-note" style={{ marginTop: 4 }}>
              Only you can see or disconnect this. Matched client mail shows on the client&apos;s
              record for the team.
            </div>
          </div>
          {PROVIDERS.map((p) => (
            <ConnectButton
              key={p}
              provider={p}
              scope="personal"
              enabled={connectable[p]}
              label={`Connect ${PROVIDER_LABEL[p]}`}
            />
          ))}
        </div>
        {mine.length > 0 ? (
          mine.map((c) => <MailboxRow key={c.id} c={c} canManage />)
        ) : (
          <div className="lx-empty">No personal mailbox connected.</div>
        )}
      </section>

      <section className="lx-card">
        <div className="lx-card-head">
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 className="lx-h2" style={{ fontSize: 23 }}>
              Firm mailboxes
            </h2>
            <div className="lx-note" style={{ marginTop: 4 }}>
              Shared inboxes like intake@ and trademark@. Connect one by signing in as that
              mailbox. {canManageFirm ? "" : "Senior admins and owners manage these."}
            </div>
          </div>
          {canManageFirm && (
            <>
              <ConnectButton provider="google" scope="firm" enabled={connectable.google} label="Add Google Workspace" />
              <ConnectButton provider="microsoft" scope="firm" enabled={connectable.microsoft} label="Add Microsoft 365" />
            </>
          )}
        </div>
        {firm.length > 0 ? (
          firm.map((c) => <MailboxRow key={c.id} c={c} canManage={canManageFirm} />)
        ) : (
          <div className="lx-empty">No firm mailbox connected.</div>
        )}
      </section>

      <section className="lx-card lx-facts">
        <div>
          <div className="lx-label">What we read</div>
          <p>
            The sender, recipients, subject, date and a short preview. Full bodies are read only by
            the intel agent, for messages already matched to a client.
          </p>
        </div>
        <div>
          <div className="lx-label">What we store</div>
          <p>
            One timeline line per matched message, with a link back to your mail client. Access
            tokens are encrypted and scoped to this firm.
          </p>
        </div>
        <div>
          <div className="lx-label">What we never do</div>
          <p>
            Send, delete or move mail. Replies are created as <b>drafts</b> in your mailbox after
            someone approves them in the queue.
          </p>
        </div>
      </section>
    </>
  );
}
