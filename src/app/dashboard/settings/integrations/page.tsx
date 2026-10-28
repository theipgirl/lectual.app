import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { canManageScope } from "@/lib/mailbox/access";
import { connectableProviders } from "@/lib/mailbox/config";
import { listConnections, type MailboxConnection } from "@/lib/mailbox/connections";
import { outcomeMessage } from "@/lib/mailbox/outcome";
import { getLawmaticsConnection } from "@/lib/lawmatics/connection";
import { getLawPayConnection } from "@/lib/payments/lawpay-connection";
import { lawPaySetup } from "@/lib/payments/lawpay-config";
import { listMeetingConnections } from "@/lib/meetings/connection";
import Link from "next/link";
import { PROVIDER_LABEL, PROVIDERS, hasCalendarScope, isProvider, type MailboxProvider } from "@/lib/mailbox/providers";
import { relativeTime } from "@/lib/relative-time";
import { ProviderMark } from "@/components/mailbox/ProviderMark";
import { DisconnectButton } from "@/components/mailbox/DisconnectButton";
import { IntegrationRow, ROW_ICON, RowIcon } from "@/components/integrations/IntegrationRow";
import { ModeBadge, StatusPill } from "@/components/integrations/StatusPill";
import { stateForStatus, type IntegrationState } from "@/components/integrations/states";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { FROM_THEIR_EMAILS, integrationErrorLine, LAWPAY_NOT_ISSUED, SWITCH_ON_WORDS } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle("Integrations") };

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
    <>
      <span
        className="lx-btn lx-btn-sec lx-btn-sm"
        aria-disabled="true"
        aria-describedby={`switch-on-${props.provider}-${props.scope}`}
        style={{ opacity: 0.5, cursor: "not-allowed" }}
      >
        {inner}
      </span>
      <span id={`switch-on-${props.provider}-${props.scope}`} className="lx-note">
        {SWITCH_ON_WORDS}
      </span>
    </>
  );
}

/** A provider row's state from the connections the caller can see. A failed read is "couldn't check", never "not connected". */
function providerState(readOk: boolean, rows: MailboxConnection[]): IntegrationState {
  if (!readOk) return "couldnt-check";
  if (rows.some((c) => c.status === "reauth")) return "reconnect";
  if (rows.some((c) => c.status === "error")) return "needs-attention";
  return rows.some((c) => c.status === "active") ? "connected" : "not-connected";
}

function MailboxRow({ c, canManage }: { c: MailboxConnection; canManage: boolean }) {
  // Outlook only. A `reauth` row already shows "Reconnect", which fixes this too.
  const needsCalendar = c.provider === "microsoft" && c.status === "active" && !hasCalendarScope(c.provider, c.scopes);
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
            {integrationErrorLine(c.status, c.last_error)}
          </div>
        )}
        {needsCalendar && (
          <div className="lx-note" style={{ color: "var(--warn)" }}>
            {canManage
              ? "Mail keeps working. Consults from this calendar won't show in Lectual until you reconnect."
              : "Reconnect to read the calendar: ask the mailbox's owner or an admin. Mail keeps working meanwhile."}
          </div>
        )}
      </div>
      <div className="lx-mbx-count">
        <div className="lx-num">{c.matched_count}</div>
        <div className="lx-note">matched to clients</div>
      </div>
      <div style={{ textAlign: "right", minWidth: 92 }}>
        <StatusPill state={stateForStatus(c.status)} />
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
          {needsCalendar && (
            <a href={connectHref(c.provider, c.scope)} className="lx-btn lx-btn-sec lx-btn-sm">
              Reconnect to read the calendar
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
  // Integrations itself is open to every firm: Lawmatics uses the firm's own
  // token. The mailbox parts are what the `mailbox` module switches on.
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const hasMailbox = await orgHasModule("mailbox");

  const { connected, reconnected, error } = await searchParams;
  const [list, lawmatics, lawpay, meetingConns] = await Promise.all([
    hasMailbox ? listConnections() : Promise.resolve({ ok: true as const, connections: [] }),
    getLawmaticsConnection(),
    getLawPayConnection(),
    listMeetingConnections(),
  ]);
  const meetingSources = meetingConns.ok ? meetingConns.connections : [];
  const meetingsNeedAttention = meetingSources.some((c) => c.status !== "active");
  const lp = lawpay.ok ? lawpay.connection : null;
  const lawpayReady = lawPaySetup().ready;
  const lm = lawmatics.ok ? lawmatics.connection : null;
  const connectable = connectableProviders();
  const canManageFirm = canManageScope(session.role, "firm");

  const errorText = outcomeMessage(error);
  const nothingConfigured = !connectable.google && !connectable.microsoft;

  const lawmaticsState: IntegrationState = !lawmatics.ok ? "couldnt-check" : !lm ? "not-connected" : lm.status === "active" ? "connected" : "reconnect";
  const lawpayState: IntegrationState = !lawpay.ok
    ? "couldnt-check"
    : lp
      ? lp.status === "active"
        ? "connected"
        : "reconnect"
      : lawpayReady
        ? "not-connected"
        : "not-available";
  const meetingsState: IntegrationState = !meetingConns.ok
    ? "couldnt-check"
    : meetingSources.length === 0
      ? "not-connected"
      : meetingsNeedAttention
        ? "reconnect"
        : "connected";

  const byProvider = (p: MailboxProvider) => (list.ok ? list.connections.filter((c) => c.provider === p) : []);

  return (
    <>
      <div>
        <div className="lx-label">Settings</div>
        <h1 className="lx-h1" data-tour="integrations-head">Integrations</h1>
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
          We couldn&apos;t load your mailbox connections, so this list may be incomplete. Refresh to try again.
        </div>
      )}
      {nothingConfigured && (
        <div className="lx-banner lx-banner-mute">
          Connecting a mailbox isn&apos;t switched on yet. Lectual is setting it up.
        </div>
      )}

      {hasMailbox && (
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
          the &ldquo;{FROM_THEIR_EMAILS}&rdquo; assistant fills in what&apos;s missing. Everything else stays in your inbox.
        </p>
        <div className="lx-hero-actions">
          {PROVIDERS.map((p) =>
            connectable[p] ? (
              <a key={p} href={connectHref(p, "personal")} className={`lx-btn ${p === "google" ? "lx-btn-cream" : "lx-btn-glass"}`}>
                <span aria-hidden="true">↗</span> Connect {PROVIDER_LABEL[p]}
              </a>
            ) : (
              <span key={p} className={`lx-btn ${p === "google" ? "lx-btn-cream" : "lx-btn-glass"}`} aria-disabled="true" aria-describedby={`switch-on-hero-${p}`} style={{ opacity: 0.55, cursor: "not-allowed" }}>
                {PROVIDER_LABEL[p]} · not set up yet
                <span id={`switch-on-hero-${p}`} className="lx-sr">
                  {SWITCH_ON_WORDS}
                </span>
              </span>
            ),
          )}
          <a href="#how" className="lx-hero-link">
            What we read
          </a>
        </div>
      </section>
      )}

      <section className="lx-card lx-int" aria-label="Services">
        <IntegrationRow
          id="lawmatics-title"
          title="Import from Lawmatics"
          state={lawmaticsState}
          icon={<RowIcon path={ROW_ICON.lawmatics} />}
          help={
            !lawmatics.ok
              ? "We couldn't check your Lawmatics connection just now."
              : lm?.status === "active"
                ? `Connected${lm.last_import_at ? ` · last import ${relativeTime(lm.last_import_at)}` : ""}. Bring over contacts and matters, and re-run it any time to pick up changes.`
                : lm
                  ? "Lawmatics stopped accepting your firm's token. Reconnect to keep importing."
                  : "Bring over your contacts and matters, and re-run it any time while you move over."
          }
          actions={
            <Link href="/dashboard/settings/integrations/lawmatics/" className={`lx-btn ${lm?.status === "active" ? "lx-btn-sec" : "lx-btn-pri"}`}>
              {lm?.status === "active" ? "Open Lawmatics import" : lm ? "Reconnect" : "Connect Lawmatics"}
            </Link>
          }
        />
        <IntegrationRow
          id="lawpay-title"
          title="LawPay"
          state={lawpayState}
          icon={<RowIcon path={ROW_ICON.lawpay} />}
          badge={lp ? <ModeBadge live={lp.mode === "live"} /> : null}
          help={
            !lawpay.ok
              ? "We couldn't check your LawPay connection just now."
              : lp?.status === "active"
                ? `Connected${lp.display_hint ? ` · ${lp.display_hint}` : ""} · ${lp.mode === "live" ? "live" : "test"} mode. Clients pay the amount due at signing by card, into your operating account.`
                : lp
                  ? "LawPay stopped accepting your firm's connection. Reconnect to take card payments again."
                  : lawpayReady
                    ? "Sign in to your firm's LawPay account so clients can pay the amount due at signing by card."
                    : LAWPAY_NOT_ISSUED
          }
          actions={
            <Link href="/dashboard/settings/integrations/lawpay/" className={`lx-btn ${lp?.status === "active" || !lawpayReady ? "lx-btn-sec" : "lx-btn-pri"}`}>
              {lp?.status === "active" ? "Manage LawPay" : lp ? "Reconnect" : lawpayReady ? "Connect LawPay" : "About LawPay"}
            </Link>
          }
        />
        <IntegrationRow
          id="meetings-title"
          title="Meetings"
          state={meetingsState}
          icon={<RowIcon path={ROW_ICON.meetings} />}
          help={
            !meetingConns.ok
              ? "We couldn't check your meeting connections just now."
              : meetingSources.length > 0
                ? `Connected: ${meetingSources.map((c) => (c.provider === "fathom" ? "Fathom" : "Zoom")).join(" and ")}. Consult recordings, summaries and transcripts land in Meetings.`
                : "Connect Fathom or Zoom to bring consult recordings, summaries and transcripts into Meetings."
          }
          actions={
            <Link href="/dashboard/settings/integrations/meetings/" className={`lx-btn ${meetingSources.length > 0 ? "lx-btn-sec" : "lx-btn-pri"}`}>
              {meetingSources.length > 0 ? "Manage meetings" : "Connect Fathom or Zoom"}
            </Link>
          }
        />
        {hasMailbox && PROVIDERS.map((p) => {
          const rows = byProvider(p);
          const mineHere = rows.filter((c) => c.scope === "personal");
          const firmHere = rows.filter((c) => c.scope === "firm");
          return (
            <IntegrationRow
              key={p}
              title={p === "google" ? "Google Workspace" : "Microsoft 365"}
              state={providerState(list.ok, rows)}
              icon={<ProviderMark provider={p} size={24} />}
              help={`${p === "google" ? "Gmail" : "Outlook"}${rows.length > 0 ? ` · ${rows.length} connected` : ""}`}
              defaultOpen={rows.length > 0}
            >
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
            </IntegrationRow>
          );
        })}
      </section>

      {hasMailbox && (
      <section id="how" className="lx-card lx-facts">
        <div>
          <div className="lx-label">What we read</div>
          <p>
            The sender, recipients, subject, date and a short preview. Full bodies are read only by
            the &ldquo;{FROM_THEIR_EMAILS}&rdquo; assistant, for messages already matched to a client. From an Outlook calendar: the
            title, time, place, organizer and attendees of upcoming events, never the event notes.
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
      )}
    </>
  );
}
