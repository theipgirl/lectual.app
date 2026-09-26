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

/** Shown so the section has its full shape; none of these connect to anything yet. */
const SOON = [
  {
    name: "Email (IMAP)",
    sub: "Connect any other mailbox with an app password, for firms not on Gmail or Outlook.",
    icon: "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.5 7.1",
  },
  {
    name: "AI assistants",
    sub: "Connect Claude, ChatGPT or any MCP client to your workspace.",
    icon: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z",
  },
];

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

export default async function IntegrationsPage({
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

  const errorText = outcomeMessage(error);
  const nothingConfigured = !connectable.google && !connectable.microsoft;

  const byProvider = (p: MailboxProvider) => (list.ok ? list.connections.filter((c) => c.provider === p) : []);

  return (
    <>
      <div>
        <div className="lx-label">Settings</div>
        <h1 className="lx-h1">Integrations</h1>
        <p className="lx-sub">Connect outside services to your firm.</p>
      </div>

      {connected && isProvider(connected) && (
        <div role="status" className="lx-banner lx-banner-ok">
          {PROVIDER_LABEL[connected]} {reconnected ? "reconnected" : "connected"}. The first sync
          will pull the last 30 days. Matched mail shows up in My Mail.
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

      <section className="lx-hero" aria-labelledby="hero-title">
        <div className="lx-hero-marks" aria-hidden="true">
          <ProviderMark provider="google" size={22} />
          <ProviderMark provider="microsoft" size={22} />
        </div>
        <h2 id="hero-title" className="lx-hero-title">
          Bring your client mail
          <br />
          into Lectual
        </h2>
        <p className="lx-hero-sub">
          Gmail or Outlook. Mail from your clients lands on their lead or matter automatically, and
          the intel agent fills in what&apos;s missing. Everything else stays in your inbox.
        </p>
        <div className="lx-hero-actions">
          {PROVIDERS.map((p) =>
            connectable[p] ? (
              <a key={p} href={connectHref(p, "personal")} className={`lx-btn ${p === "google" ? "lx-btn-cream" : "lx-btn-glass"}`}>
                <span aria-hidden="true">↗</span> Connect {PROVIDER_LABEL[p]}
              </a>
            ) : (
              <span key={p} className={`lx-btn ${p === "google" ? "lx-btn-cream" : "lx-btn-glass"}`} aria-disabled="true" title={`${PROVIDER_LABEL[p]} isn't set up on this deployment yet`} style={{ opacity: 0.55, cursor: "not-allowed" }}>
                <span aria-hidden="true">↗</span> Connect {PROVIDER_LABEL[p]}
              </span>
            ),
          )}
          <a href="#how" className="lx-hero-link">
            What we read
          </a>
        </div>
      </section>

      <section className="lx-int-import" aria-labelledby="lawmatics-title">
        <div style={{ flex: 1, minWidth: 240 }}>
          <h2 id="lawmatics-title" className="lx-h2" style={{ fontSize: 27 }}>
            Import from Lawmatics
          </h2>
          <p className="lx-sub" style={{ margin: "4px 0 0" }}>
            Bring over your contacts and matters, and keep them in step while you move over.
          </p>
        </div>
        <span className="lx-btn lx-btn-sec" aria-disabled="true" style={{ opacity: 0.6, cursor: "not-allowed" }}>
          Coming soon
        </span>
      </section>

      <section className="lx-card lx-int" aria-label="Services">
        {PROVIDERS.map((p) => {
          const rows = byProvider(p);
          const mineHere = rows.filter((c) => c.scope === "personal");
          const firmHere = rows.filter((c) => c.scope === "firm");
          return (
            <details key={p} className="lx-int-row" open={rows.length > 0}>
              <summary>
                <span className="lx-int-icon">
                  <ProviderMark provider={p} size={24} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="lx-int-name">{p === "google" ? "Google Workspace" : "Microsoft 365"}</span>
                  <span className="lx-note" style={{ display: "block" }}>
                    {p === "google" ? "Gmail" : "Outlook"}
                    {rows.length > 0 ? ` · ${rows.length} connected` : ""}
                  </span>
                </span>
                {rows.some((c) => c.status === "reauth") && <span className="lx-pill lx-pill-risk">Reconnect</span>}
                <span className="lx-int-chev" aria-hidden="true">›</span>
              </summary>
              <div className="lx-int-body">
                <div className="lx-card-head">
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <b style={{ color: "var(--ink)" }}>My mailbox</b>
                    <div className="lx-note">Only you can see or disconnect this.</div>
                  </div>
                  <ConnectButton provider={p} scope="personal" enabled={connectable[p]} label={mineHere.length ? "Connect another" : `Connect ${PROVIDER_LABEL[p]}`} />
                </div>
                {mineHere.length > 0 ? mineHere.map((c) => <MailboxRow key={c.id} c={c} canManage />) : <div className="lx-empty">No personal {PROVIDER_LABEL[p]} connected.</div>}
                <div className="lx-card-head">
                  <div style={{ flex: 1, minWidth: 220 }}>
                    <b style={{ color: "var(--ink)" }}>Firm mailboxes</b>
                    <div className="lx-note">
                      Shared inboxes like intake@. Connect one by signing in as that mailbox.{" "}
                      {canManageFirm ? "" : "Senior admins and owners manage these."}
                    </div>
                  </div>
                  {canManageFirm && <ConnectButton provider={p} scope="firm" enabled={connectable[p]} label="Add shared mailbox" />}
                </div>
                {firmHere.length > 0 ? firmHere.map((c) => <MailboxRow key={c.id} c={c} canManage={canManageFirm} />) : <div className="lx-empty">No shared {PROVIDER_LABEL[p]} mailbox.</div>}
              </div>
            </details>
          );
        })}
        {SOON.map((x) => (
          <div key={x.name} className="lx-int-row lx-int-soon">
            <div className="lx-int-summary">
              <span className="lx-int-icon" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d={x.icon} />
                </svg>
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="lx-int-name">{x.name}</span>
                <span className="lx-note" style={{ display: "block" }}>
                  {x.sub}
                </span>
              </span>
              <span className="lx-pill lx-pill-mute">Coming soon</span>
            </div>
          </div>
        ))}
      </section>

      <section id="how" className="lx-card lx-facts">
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
