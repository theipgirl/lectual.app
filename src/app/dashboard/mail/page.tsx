import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { inPreview, previewingAs, resolveViewSession } from "@/lib/views/view-as";
import { orgHasModule } from "@/lib/org/modules";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listConnections } from "@/lib/mailbox/connections";
import { MAILBOX_ACTIVITY_SOURCE } from "@/lib/mailbox/apply";
import { PROVIDER_LABEL } from "@/lib/mailbox/providers";
import { groupMailByDay, mailTime, toMailRows, type MailActivity } from "@/lib/mailbox/my-mail";
import { relativeTime } from "@/lib/relative-time";
import { getFirmTimeZone } from "@/lib/org/profile";
import { EmptyState, LoadFailedCard, Notice, PageHeader, PageTabs } from "@/components/ui";
import { MAIL_NAME, VIEW_AS_LIVE_MAIL, VIEW_AS_PRIVATE_MAIL, noneYet } from "@/lib/ui/words";
import { ProviderMark } from "@/components/mailbox/ProviderMark";
import { loadLiveInbox, loadLiveMessage, loadStoredMessage, type ReadState } from "@/lib/mailbox/read-message";
import { liveMailReadDeps } from "@/lib/mailbox/read-message-live";
import { MailReadingPane, MailPaneLoading } from "@/components/mailbox/MailReadingPane";
import { LiveInboxList } from "@/components/mailbox/LiveInboxList";
import "@/components/mailbox/mail-pane.css";
import { MailFolderSelect } from "@/components/mailbox/MailFolderSelect";
import { folderSelect, type MailNavLink } from "@/lib/mailbox/folder-select";
import type { Metadata } from "next";
import { matterDisplayTitle } from "@/lib/matters/display-title";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle(MAIL_NAME) };

export const dynamic = "force-dynamic";

const INTEGRATIONS = "/dashboard/settings/integrations/";

function ConnectMailbox() {
  return (
    <div className="lx-card lx-connect">
      <div className="lx-connect-icon" aria-hidden="true">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="5" width="18" height="14" rx="2.5" />
          <path d="M3.5 7l8.5 6 8.5-6" />
        </svg>
      </div>
      <h1 className="lx-h1 lx-connect-title">Connect your mailbox</h1>
      <p className="lx-sub lx-connect-sub">
        Connect your Gmail or Outlook account to bring in email from your clients and link it to their leads and matters.
      </p>
      <Link href={INTEGRATIONS} className="lx-btn lx-btn-pri">
        Go to Integrations
      </Link>
    </div>
  );
}

async function PaneLoader({ state, backHref, timeZone, listLabel }: { state: Promise<ReadState>; backHref: string; timeZone: string; listLabel: string }) {
  return <MailReadingPane state={await state} backHref={backHref} timeZone={timeZone} listLabel={listLabel} />;
}

/**
 * My Mail: client mail matched from the mailboxes this person can see. Not a
 * full inbox, on purpose: mail that matched no client was never stored, and
 * bodies never are. Module-gated like every mailbox surface.
 */
export default async function MyMailPage({ searchParams }: { searchParams: Promise<{ box?: string; f?: string; m?: string; tab?: string; live?: string }> }) {
  if (!(await orgHasModule("mailbox"))) notFound();
  const session = await resolveViewSession();
  if (session.kind !== "ok") notFound();
  const { box, f, m, tab, live } = await searchParams;
  // View as (D2, D11): only the firm's SHARED mailboxes, from stored rows. A personal mailbox (the owner's own, visible to
  // them by RLS) is never shown in a teammate's view, and the live Inbox tab and reading pane are not fetched (a provider
  // read may refresh a token, which a preview must never do).
  const previewing = await previewingAs();
  // Live reads are skipped on the FLAG (on, or couldn't be checked), not only when a teammate is named (Layer d).
  const skipLive = await inPreview();
  const inboxTab = tab === "inbox" && !skipLive;
  const sent = f === "sent";

  const list = await listConnections();
  if (!list.ok) {
    // Unknown is not "none": never tell someone to connect a mailbox they may already have.
    return <LoadFailedCard role="alert" what="your mail" body="We couldn't load your mailbox connections, so we can't show your mail right now. Refresh to try again." />;
  }
  const connections = list.connections.filter((c) => c.status !== "revoked" && (!previewing || c.scope === "firm"));
  if (connections.length === 0 && previewing) {
    return (
      <>
        <PageHeader title={MAIL_NAME} />
        <EmptyState>{VIEW_AS_PRIVATE_MAIL(previewing.name)}</EmptyState>
      </>
    );
  }
  if (connections.length === 0) return <ConnectMailbox />;

  const selected = connections.find((c) => c.id === box) ?? null;
  const ids = selected ? [selected.id] : connections.map((c) => c.id);

  const supabase = await getScopedClient();
  const { data, error } = inboxTab
    ? { data: [], error: null }
    : await supabase
        .from("crm_activity")
        .select("id, type, created_at, lead_id, matter_id, payload")
        .eq("type", sent ? "email_sent" : "email_received")
        .eq("payload->>source", MAILBOX_ACTIVITY_SOURCE)
        .in("payload->>connection_id", ids)
        .order("created_at", { ascending: false })
        .limit(200);
  const activity = (data ?? []) as MailActivity[];

  const leadIds = [...new Set(activity.map((a) => a.lead_id).filter((x): x is string => !!x))];
  const matterIds = [...new Set(activity.map((a) => a.matter_id).filter((x): x is string => !!x))];
  const [{ data: leads }, { data: matters }] = await Promise.all([
    // live-guard: names the leads that stored mail rows point at (history: mail stays on a merged lead)
    leadIds.length ? supabase.from("crm_lead").select("id, first_name, last_name, business_name, email").in("id", leadIds) : Promise.resolve({ data: [] as never[] }),
    matterIds.length ? supabase.from("crm_matter").select("id, mark_text, title, matter_number, owner_name").in("id", matterIds) : Promise.resolve({ data: [] as never[] }),
  ]);
  const names = {
    leads: new Map((leads ?? []).map((l) => [l.id, l.business_name || `${l.first_name} ${l.last_name}`.trim() || l.email] as [string, string])),
    matters: new Map((matters ?? []).map((m) => [m.id, matterDisplayTitle(m).title] as [string, string])),
  };
  const now = new Date();
  const tz = await getFirmTimeZone();
  const groups = groupMailByDay(toMailRows(activity, names), now, tz);
  const providerOf = new Map(connections.map((c) => [c.id, c.provider] as const));
  const needsReconnect = connections.filter((c) => c.status === "reauth");

  const href = (next: { box?: string | null; f?: string | null; m?: string | null; tab?: string | null; live?: string | null }) => {
    const q = new URLSearchParams();
    const b = next.box === undefined ? selected?.id : next.box;
    const ff = next.f === undefined ? (sent ? "sent" : null) : next.f;
    const t = next.tab === undefined ? (inboxTab ? "inbox" : null) : next.tab;
    if (b) q.set("box", b);
    if (ff) q.set("f", ff);
    if (t) q.set("tab", t);
    if (next.m) q.set("m", next.m);
    if (next.live) q.set("live", next.live);
    const qs = q.toString();
    return `/dashboard/mail/${qs ? `?${qs}` : ""}`;
  };

  // The reading pane: `m` (a stored row) wins over `box` + `live`. Each re-checks access on this request.
  const paneOpen = !skipLive && (Boolean(m) || Boolean(live));
  const backHref = href({ m: null, live: null });
  const paneState = skipLive ? null : m ? loadStoredMessage(m, liveMailReadDeps) : live ? loadLiveMessage(box, live, liveMailReadDeps) : null;
  const inbox = inboxTab ? await loadLiveInbox(box, liveMailReadDeps) : null;

  // The sidebar links and the phone's select are built from this one list, so they cannot disagree.
  const navLinks: MailNavLink[] = [
    { key: "received", group: "Folders", label: "Received", href: href({ f: null, tab: null, m: null, live: null }), current: !sent && !inboxTab },
    { key: "sent", group: "Folders", label: "Sent", href: href({ f: "sent", tab: null, m: null, live: null }), current: sent && !inboxTab },
    { key: "all", group: "Mailboxes", label: "All mailboxes", href: href({ box: null, m: null, live: null }), current: !selected },
    ...connections.map((c): MailNavLink => ({ key: c.id, group: "Mailboxes", label: c.email, href: href({ box: c.id, m: null, live: null }), current: selected?.id === c.id })),
  ];
  const folderLinks = navLinks.filter((l) => l.group === "Folders");
  const boxLink = (key: string) => navLinks.find((l) => l.key === key)!;

  return (
    <div className="lx-split">
      <aside className="lx-side lx-mail-side" aria-label="Mailboxes">
        <div className="lx-label">Folders</div>
        <nav className="lx-mail-nav">
          {folderLinks.map((l) => (
            <Link key={l.key} href={l.href} className="lx-fi" aria-current={l.current ? "page" : undefined}>
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="lx-label lx-mail-side-gap">Mailboxes</div>
        <nav className="lx-mail-nav">
          <Link href={boxLink("all").href} className="lx-fi" aria-current={!selected ? "page" : undefined}>
            All mailboxes
          </Link>
          {connections.map((c) => (
            <Link key={c.id} href={boxLink(c.id).href} className="lx-fi lx-fi-box" aria-current={selected?.id === c.id ? "page" : undefined} title={c.email}>
              <ProviderMark provider={c.provider} size={14} />
              <span className="lx-fi-text">{c.email}</span>
              {c.status === "reauth" && <span className="lx-fi-n lx-mail-reauth">!</span>}
            </Link>
          ))}
        </nav>
        <Link href={INTEGRATIONS} className="lx-note">
          Manage in Integrations →
        </Link>
      </aside>

      <div className="lx-col">
        <PageHeader
          title={MAIL_NAME}
          details={selected ? `${PROVIDER_LABEL[selected.provider]} · ${selected.email}` : `${connections.length} mailbox${connections.length === 1 ? "" : "es"}`}
          sub={inboxTab ? "The newest messages in the mailbox, read live. Nothing here is saved." : "Mail with your clients, already linked to their lead or matter. Everything else stays in your inbox."}
        />

        {needsReconnect.length > 0 && (
          <Notice tone="risk" role="alert">
            {needsReconnect.map((c) => c.email).join(", ")} {needsReconnect.length === 1 ? "needs" : "need"} reconnecting before new mail can come in.{" "}
            <Link href={INTEGRATIONS}>Reconnect</Link>
          </Notice>
        )}

        {skipLive && (
          <Notice tone="mute">
            {previewing ? `${VIEW_AS_PRIVATE_MAIL(previewing.name)} ` : ""}
            {VIEW_AS_LIVE_MAIL}
          </Notice>
        )}

        <MailFolderSelect select={folderSelect(navLinks)} />

        <PageTabs
          label="Mail views"
          tabs={[
            { href: href({ tab: null, m: null, live: null }), label: "Client mail", current: !inboxTab },
            ...(skipLive ? [] : [{ href: href({ tab: "inbox", m: null, live: null, f: null }), label: "Inbox", current: inboxTab }]),
          ]}
        />

        <div className="lx-mail-wrap" data-pane={paneOpen ? "open" : undefined}>
          {inbox ? (
            <LiveInboxList state={inbox} now={now} timeZone={tz} openHref={(id) => href({ box: inbox.status === "ok" ? inbox.mailbox.id : selected?.id ?? null, live: id, m: null })} />
          ) : (
            <>
        {error ? (
          <div className="lx-mail-list">
            <LoadFailedCard role="alert" what="your mail" />
          </div>
        ) : groups.length === 0 ? (
          <div className="lx-mail-list">
            <EmptyState title={sent ? "Nothing sent to clients yet" : noneYet("client mail")}>
              {connections.every((c) => !c.last_synced_at)
                ? "The first sync hasn't run yet. It pulls the last 30 days, and then keeps checking for new mail."
                : `Last checked ${relativeTime(connections.map((c) => c.last_synced_at ?? "").sort().at(-1) ?? now.toISOString(), now.getTime(), tz)}. Only mail with your leads and clients shows here.`}
            </EmptyState>
          </div>
        ) : (
          <div className="lx-card lx-mail lx-mail-list">
            {groups.map((g) => (
              <section key={g.key} aria-labelledby={`mail-${g.key}`}>
                <h2 id={`mail-${g.key}`} className="lx-mail-group">
                  {g.label}
                </h2>
                <ul className="lx-list">
                  {g.rows.map((r) => (
                    <li key={r.id} className="lx-mail-row">
                      <span className="lx-mail-who">{r.direction === "out" ? `To ${r.to[0] ?? "client"}${r.to.length > 1 ? ` +${r.to.length - 1}` : ""}` : r.from}</span>
                      <span className="lx-mail-subj">
                        <Link href={href({ m: r.id })} className="lx-mail-rowlink">
                          {r.subject}
                        </Link>
                        {r.client && (
                          <Link href={r.client.href} className="lx-pill lx-pill-ox lx-mail-tag">
                            {r.client.label}
                          </Link>
                        )}
                      </span>
                      <span className="lx-mail-meta">
                        <span className="lx-num">{mailTime(r.at, now, tz)}</span>
                        {r.link && (
                          <a href={r.link} target="_blank" rel="noreferrer noopener" className="lx-note">
                            Open in {providerOf.get(r.connectionId ?? "") === "google" ? "Gmail" : "Outlook"}{" "}<Icon name="external" size={14} />
                          </a>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
            </>
          )}
          {paneState && (
            <Suspense fallback={<MailPaneLoading />}>
              <PaneLoader state={paneState} backHref={backHref} timeZone={tz} listLabel={inboxTab ? "Inbox" : "Client mail"} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
