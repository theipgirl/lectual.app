import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { hasRole } from "@/lib/auth/roles";
import { formatDuration, formatWhen, linkLabels, listMeetings, type MeetingFilters } from "@/lib/meetings/read";
import { listMeetingConnections } from "@/lib/meetings/connection";
import { PROVIDER_LABEL, isMeetingProvider } from "@/lib/meetings/types";

export const dynamic = "force-dynamic";

/**
 * Meetings: the firm's consult recordings imported from ITS OWN Fathom / Zoom
 * account (lectual 0077). No module gate: there is no deployment-wide
 * credential behind this page, and every row is RLS-scoped to the firm.
 *
 * Three states, never two: a failed read says so, and only a read that
 * succeeded with no rows is "no meetings yet".
 */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ provider?: string; link?: string }> }) {
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();
  const { provider: providerRaw, link: linkRaw } = await searchParams;
  const filters: MeetingFilters = {
    provider: isMeetingProvider(providerRaw) ? providerRaw : null,
    linked: linkRaw === "linked" || linkRaw === "unlinked" ? linkRaw : null,
  };
  const filtered = Boolean(filters.provider || filters.linked);

  const [read, conns] = await Promise.all([listMeetings(filters), listMeetingConnections()]);
  const meetings = read.status === "ok" ? read.meetings : [];
  const labels = await linkLabels(
    meetings.flatMap((m) => (m.lead_id ? [m.lead_id] : [])),
    meetings.flatMap((m) => (m.matter_id ? [m.matter_id] : [])),
  );
  const connected = conns.ok ? conns.connections : [];
  const canManage = hasRole(session.role, "senior_admin");

  const href = (next: { provider?: string | null; link?: string | null }) => {
    const p = new URLSearchParams();
    const prov = next.provider === undefined ? filters.provider : next.provider;
    const link = next.link === undefined ? filters.linked : next.link;
    if (prov) p.set("provider", prov);
    if (link) p.set("link", link);
    const qs = p.toString();
    return `/dashboard/meetings/${qs ? `?${qs}` : ""}`;
  };
  const chips: { key: string; label: string; to: string; on: boolean }[] = [
    { key: "all", label: "All", to: href({ provider: null, link: null }), on: !filtered },
    { key: "fathom", label: "Fathom", to: href({ provider: filters.provider === "fathom" ? null : "fathom" }), on: filters.provider === "fathom" },
    { key: "zoom", label: "Zoom", to: href({ provider: filters.provider === "zoom" ? null : "zoom" }), on: filters.provider === "zoom" },
    { key: "linked", label: "Linked", to: href({ link: filters.linked === "linked" ? null : "linked" }), on: filters.linked === "linked" },
    { key: "unlinked", label: "Not linked", to: href({ link: filters.linked === "unlinked" ? null : "unlinked" }), on: filters.linked === "unlinked" },
  ];

  return (
    <>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">Communication</div>
          <h1 className="lx-h1">Meetings</h1>
          <p className="lx-sub">Consults and calls recorded in Fathom or Zoom, with the summary, the transcript and the client they were about.</p>
        </div>
        <Link href="/dashboard/settings/integrations/meetings/" className="lx-btn lx-btn-sec lx-btn-sm">
          {connected.length ? "Manage sources" : "Connect Fathom or Zoom"}
        </Link>
      </div>

      <nav aria-label="Filter meetings" className="lx-chips">
        {chips.map((c) => (
          <Link key={c.key} href={c.to} aria-current={c.on ? "page" : undefined}>
            {c.label}
          </Link>
        ))}
      </nav>

      {conns.ok && connected.some((c) => c.status !== "active") && (
        <div role="alert" className="lx-banner lx-banner-risk">
          {connected
            .filter((c) => c.status !== "active")
            .map((c) => PROVIDER_LABEL[c.provider])
            .join(" and ")}{" "}
          stopped accepting your firm&apos;s connection, so new meetings aren&apos;t coming in.{" "}
          {canManage ? <Link href="/dashboard/settings/integrations/meetings/">Reconnect</Link> : "Ask an owner or admin to reconnect it."}
        </div>
      )}

      {read.status === "unavailable" ? (
        <div className="lx-card lx-empty-card">
          <h2 className="lx-h2" style={{ fontSize: 25 }}>Meetings couldn&apos;t be loaded</h2>
          <p className="lx-note" style={{ margin: 0 }}>This is a problem reaching the database, not an empty list. Try again in a moment.</p>
        </div>
      ) : meetings.length === 0 ? (
        <div className="lx-card lx-empty-card">
          {filtered ? (
            <>
              <h2 className="lx-h2" style={{ fontSize: 25 }}>Nothing matches</h2>
              <p className="lx-note" style={{ margin: 0 }}>Try another filter.</p>
            </>
          ) : connected.length > 0 ? (
            <>
              <h2 className="lx-h2" style={{ fontSize: 25 }}>No meetings imported yet</h2>
              <p className="lx-note" style={{ margin: 0 }}>
                {connected.map((c) => PROVIDER_LABEL[c.provider]).join(" and ")} {connected.length > 1 ? "are" : "is"} connected. New recordings come in once a
                day{canManage ? ", or press Import recent meetings in Settings → Integrations → Meetings" : ""}.
              </p>
            </>
          ) : (
            <>
              <h2 className="lx-h2" style={{ fontSize: 25 }}>Bring in your consult recordings</h2>
              <p className="lx-note" style={{ margin: 0 }}>
                Connect your firm&apos;s Fathom account (with an API key from Fathom → Settings → API Access) or sign in to Zoom. Each recorded meeting
                arrives with its summary and transcript, and is filed on the client whose email was on the invite.
              </p>
              {canManage ? (
                <div>
                  <Link href="/dashboard/settings/integrations/meetings/" className="lx-btn lx-btn-pri lx-btn-sm">
                    Connect Fathom or Zoom
                  </Link>
                </div>
              ) : (
                <p className="lx-note" style={{ margin: 0 }}>An owner or admin connects it in Settings → Integrations.</p>
              )}
            </>
          )}
        </div>
      ) : (
        <section className="lx-card" aria-label="Meetings">
          <div style={{ overflow: "auto" }}>
            <table className="lx-tbl">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Meeting</th>
                  <th>Source</th>
                  <th>Attendees</th>
                  <th>Client</th>
                  <th>Transcript</th>
                </tr>
              </thead>
              <tbody>
                {meetings.map((m) => {
                  const client = m.lead_id ? labels.leads.get(m.lead_id) ?? "Lead" : m.matter_id ? labels.matters.get(m.matter_id) ?? "Matter" : null;
                  const shown = m.attendees.slice(0, 3).map((a) => a.name || a.email).join(", ");
                  return (
                    <tr key={m.id}>
                      <td className="lx-num" style={{ whiteSpace: "nowrap" }}>
                        {formatWhen(m.started_at)}
                        <div className="lx-note">{formatDuration(m.duration_seconds)}</div>
                      </td>
                      <td className="pri">
                        <Link href={`/dashboard/meetings/${m.id}/`} className="lx-rowlink">
                          {m.title}
                        </Link>
                      </td>
                      <td>{PROVIDER_LABEL[m.provider]}</td>
                      <td>
                        {shown || <span className="lx-note">—</span>}
                        {m.attendees.length > 3 && <span className="lx-note"> +{m.attendees.length - 3}</span>}
                      </td>
                      <td>
                        {client ? (
                          <Link href={m.lead_id ? `/dashboard/leads/${m.lead_id}/` : `/dashboard/matters/${m.matter_id}/`}>{client}</Link>
                        ) : m.suggested_lead_id || m.suggested_matter_id ? (
                          <span className="lx-pill lx-pill-warn">Suggested</span>
                        ) : (
                          <span className="lx-note">Not linked</span>
                        )}
                      </td>
                      <td>{m.has_transcript ? <span className="lx-pill lx-pill-ok">Yes</span> : <span className="lx-note">No</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
