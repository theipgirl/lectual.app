import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { orgHasModule } from "@/lib/org/modules";
import { getScopedClient } from "@/lib/db/scoped-client";
import { listConnections } from "@/lib/mailbox/connections";
import { MAILBOX_ACTIVITY_SOURCE } from "@/lib/mailbox/apply";
import { PROVIDER_LABEL } from "@/lib/mailbox/providers";
import { groupMailByDay, mailTime, toMailRows, type MailActivity } from "@/lib/mailbox/my-mail";
import { relativeTime } from "@/lib/relative-time";
import { ProviderMark } from "@/components/mailbox/ProviderMark";

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
      <h1 className="lx-h2" style={{ fontSize: 30, textAlign: "center" }}>
        Connect your mailbox
      </h1>
      <p className="lx-sub" style={{ textAlign: "center", maxWidth: 480, margin: 0 }}>
        Connect your Gmail or Outlook account to bring in email from your clients and link it to their leads and matters.
      </p>
      <Link href={INTEGRATIONS} className="lx-btn lx-btn-pri">
        Go to Integrations
      </Link>
    </div>
  );
}

/**
 * My Mail: client mail matched from the mailboxes this person can see. Not a
 * full inbox, on purpose: mail that matched no client was never stored, and
 * bodies never are. Module-gated like every mailbox surface.
 */
export default async function MyMailPage({ searchParams }: { searchParams: Promise<{ box?: string; f?: string }> }) {
  if (!(await orgHasModule("mailbox"))) notFound();
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const { box, f } = await searchParams;
  const sent = f === "sent";

  const list = await listConnections();
  if (!list.ok) {
    // Unknown is not "none": never tell someone to connect a mailbox they may already have.
    return (
      <div role="alert" className="lx-banner lx-banner-risk">
        We couldn&apos;t load your mailbox connections, so we can&apos;t show your mail right now. Try again shortly.
      </div>
    );
  }
  const connections = list.connections.filter((c) => c.status !== "revoked");
  if (connections.length === 0) return <ConnectMailbox />;

  const selected = connections.find((c) => c.id === box) ?? null;
  const ids = selected ? [selected.id] : connections.map((c) => c.id);

  const supabase = await getScopedClient();
  const { data, error } = await supabase
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
    leadIds.length ? supabase.from("crm_lead").select("id, first_name, last_name, business_name, email").in("id", leadIds) : Promise.resolve({ data: [] as never[] }),
    matterIds.length ? supabase.from("crm_matter").select("id, mark_text, title, matter_number").in("id", matterIds) : Promise.resolve({ data: [] as never[] }),
  ]);
  const names = {
    leads: new Map((leads ?? []).map((l) => [l.id, l.business_name || `${l.first_name} ${l.last_name}`.trim() || l.email] as [string, string])),
    matters: new Map((matters ?? []).map((m) => [m.id, m.mark_text ?? m.title ?? m.matter_number] as [string, string])),
  };
  const now = new Date();
  const groups = groupMailByDay(toMailRows(activity, names), now);
  const needsReconnect = connections.filter((c) => c.status === "reauth");

  const href = (next: { box?: string | null; f?: string | null }) => {
    const q = new URLSearchParams();
    const b = next.box === undefined ? selected?.id : next.box;
    const ff = next.f === undefined ? (sent ? "sent" : null) : next.f;
    if (b) q.set("box", b);
    if (ff) q.set("f", ff);
    const qs = q.toString();
    return `/dashboard/mail/${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="lx-split">
      <aside className="lx-side" aria-label="Mailboxes">
        <div className="lx-label">Folders</div>
        <nav style={{ display: "grid", gap: 2 }}>
          <Link href={href({ f: null })} className="lx-fi" aria-current={!sent ? "page" : undefined}>
            Inbox
          </Link>
          <Link href={href({ f: "sent" })} className="lx-fi" aria-current={sent ? "page" : undefined}>
            Sent
          </Link>
        </nav>
        <div className="lx-label" style={{ marginTop: 8 }}>
          Mailboxes
        </div>
        <nav style={{ display: "grid", gap: 2 }}>
          <Link href={href({ box: null })} className="lx-fi" aria-current={!selected ? "page" : undefined}>
            All mailboxes
          </Link>
          {connections.map((c) => (
            <Link key={c.id} href={href({ box: c.id })} className="lx-fi lx-fi-box" aria-current={selected?.id === c.id ? "page" : undefined} title={c.email}>
              <ProviderMark provider={c.provider} size={14} />
              <span className="lx-fi-text">{c.email}</span>
              {c.status === "reauth" && <span className="lx-fi-n" style={{ color: "var(--wine)" }}>!</span>}
            </Link>
          ))}
        </nav>
        <Link href={INTEGRATIONS} className="lx-note">
          Manage in Integrations →
        </Link>
      </aside>

      <div className="lx-col">
        <div className="lx-page-head">
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="lx-label">{selected ? `${PROVIDER_LABEL[selected.provider]} · ${selected.email}` : `${connections.length} mailbox${connections.length === 1 ? "" : "es"}`}</div>
            <h1 className="lx-h1">My Mail</h1>
            <p className="lx-sub">Mail with your clients, already linked to their lead or matter. Everything else stays in your inbox.</p>
          </div>
        </div>

        {needsReconnect.length > 0 && (
          <div role="alert" className="lx-banner lx-banner-risk">
            {needsReconnect.map((c) => c.email).join(", ")} {needsReconnect.length === 1 ? "needs" : "need"} reconnecting before new mail can come in.{" "}
            <Link href={INTEGRATIONS}>Reconnect</Link>
          </div>
        )}

        {error ? (
          <div className="lx-card lx-empty-card">
            <h2 className="lx-h2" style={{ fontSize: 25 }}>Mail couldn&apos;t be loaded</h2>
            <p className="lx-note" style={{ margin: 0 }}>This is a problem reaching the database, not an empty mailbox. Try again shortly.</p>
          </div>
        ) : groups.length === 0 ? (
          <div className="lx-card lx-empty-card">
            <h2 className="lx-h2" style={{ fontSize: 25 }}>{sent ? "Nothing sent to clients yet" : "No client mail yet"}</h2>
            <p className="lx-note" style={{ margin: 0 }}>
              {connections.every((c) => !c.last_synced_at)
                ? "The first sync hasn't run yet. It pulls the last 30 days, and then keeps checking for new mail."
                : `Last checked ${relativeTime(connections.map((c) => c.last_synced_at ?? "").sort().at(-1) ?? now.toISOString())}. Only mail with your leads and clients shows here.`}
            </p>
          </div>
        ) : (
          <div className="lx-card lx-mail">
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
                        {r.subject}
                        {r.client && (
                          <Link href={r.client.href} className="lx-pill lx-pill-ox lx-mail-tag">
                            {r.client.label}
                          </Link>
                        )}
                      </span>
                      <span className="lx-mail-meta">
                        <span className="lx-num">{mailTime(r.at, now)}</span>
                        {r.link && (
                          <a href={r.link} target="_blank" rel="noreferrer noopener" className="lx-note">
                            Open ↗
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
      </div>
    </div>
  );
}
