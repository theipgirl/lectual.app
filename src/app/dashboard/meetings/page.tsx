import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveViewSession } from "@/lib/views/view-as";
import { formatDuration, formatWhen, linkLabels, listMeetings, type MeetingFilters } from "@/lib/meetings/read";
import { listMeetingConnections } from "@/lib/meetings/connection";
import { PROVIDER_LABEL, isMeetingProvider } from "@/lib/meetings/types";
import type { Metadata } from "next";
import { pageTitle } from "@/lib/ui/page-title";
import { SyncMeetingsControl } from "@/components/meetings/SyncMeetingsButton";
import { canSyncMeetings, syncControl } from "@/lib/meetings/sync-access";
import { reconnectSentence } from "@/lib/meetings/reconnect-copy";
import { ADMIN_TIER_PHRASE } from "@/lib/setup/roles";
import { getFirmTimeZone } from "@/lib/org/profile";
import { EmptyState, LoadFailedCard, Notice, PageHeader, Pill, SheetCard, SheetScroll, SheetTable } from "@/components/ui";
import { Chip, FilterChips } from "@/components/list-page/Chips";
import { BLANK } from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle("Meetings") };

export const dynamic = "force-dynamic";

/**
 * Meetings: the firm's consult recordings imported from ITS OWN Fathom / Zoom
 * account (lectual 0081). No module gate: there is no deployment-wide
 * credential behind this page, and every row is RLS-scoped to the firm.
 *
 * Three states, never two: a failed read says so, and only a read that
 * succeeded with no rows is "no meetings yet".
 */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ provider?: string; link?: string }> }) {
  const session = await resolveViewSession();
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
  const canManage = canSyncMeetings(session.role);
  const tz = await getFirmTimeZone();

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
      <PageHeader
        title="Meetings"
        tour="meetings-head"
        sub="Consults and calls recorded in Fathom or Zoom, with the summary, the transcript and the client they were about."
        actions={
          <>
            <SyncMeetingsControl control={syncControl(session.role, conns.ok ? connected : null)} />
            {(connected.length > 0 || !canSyncMeetings(session.role)) && (
              <Link href="/dashboard/settings/integrations/meetings/" className="lx-btn lx-btn-sec">
                {connected.length ? "Manage sources" : "Connect Fathom or Zoom"}
              </Link>
            )}
          </>
        }
      />

      <FilterChips as="nav" label="Filter meetings">
        {chips.map((c) => (
          <Chip key={c.key} href={c.to} active={c.on}>
            {c.label}
          </Chip>
        ))}
      </FilterChips>

      {conns.ok && connected.some((c) => c.status !== "active") && (
        <Notice tone="risk" role="alert">
          {reconnectSentence(connected.filter((c) => c.status !== "active").map((c) => PROVIDER_LABEL[c.provider]))}{" "}
          {canManage ? <Link href="/dashboard/settings/integrations/meetings/">Reconnect</Link> : `${ADMIN_TIER_PHRASE} can reconnect it.`}
        </Notice>
      )}

      {read.status === "unavailable" ? (
        <LoadFailedCard role="alert" what="meetings" />
      ) : meetings.length === 0 ? (
        filtered ? (
          <EmptyState title="Nothing matches">Try another filter.</EmptyState>
        ) : connected.length > 0 ? (
          <EmptyState title="No meetings imported yet">
            {connected.map((c) => PROVIDER_LABEL[c.provider]).join(" and ")} {connected.length > 1 ? "are" : "is"} connected. New recordings come in once a day
            {canManage ? ", or press Import recent meetings in Settings → Integrations → Meetings" : ""}.
          </EmptyState>
        ) : (
          <EmptyState
            title="Bring in your consult recordings"
            action={
              canManage ? (
                <Link href="/dashboard/settings/integrations/meetings/" className="lx-btn lx-btn-pri">
                  Connect Fathom or Zoom
                </Link>
              ) : (
                <p className="lx-note">{ADMIN_TIER_PHRASE} can connect it in Settings → Integrations.</p>
              )
            }
          >
            Connect your firm&apos;s Fathom account (with an API key from Fathom → Settings → API Access) or sign in to Zoom. Each recorded meeting arrives with
            its summary and transcript, and is filed on the client whose email was on the invite.
          </EmptyState>
        )
      ) : (
        <SheetCard as="section" aria-label="Meetings">
          <SheetScroll>
            <SheetTable minWidth={760}>
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
                      <td data-label="When">
                        {formatWhen(m.started_at, tz)}
                        <div className="lx-note">{formatDuration(m.duration_seconds)}</div>
                      </td>
                      <td className="pri">
                        <Link href={`/dashboard/meetings/${m.id}/`} className="lx-rowlink">
                          {m.title}
                        </Link>
                      </td>
                      <td data-label="Source">{PROVIDER_LABEL[m.provider]}</td>
                      <td data-label="Attendees">
                        {shown || <span className="lx-note">{BLANK}</span>}
                        {m.attendees.length > 3 && <span className="lx-note"> +{m.attendees.length - 3}</span>}
                      </td>
                      <td data-label="Client">
                        {client ? (
                          <Link href={m.lead_id ? `/dashboard/leads/${m.lead_id}/` : `/dashboard/matters/${m.matter_id}/`}>{client}</Link>
                        ) : m.suggested_lead_id || m.suggested_matter_id ? (
                          <Pill tone="warn">Suggested</Pill>
                        ) : (
                          <span className="lx-note">Not linked</span>
                        )}
                      </td>
                      <td data-label="Transcript">{m.has_transcript ? <Pill tone="ok">Yes</Pill> : <span className="lx-note">No</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </SheetTable>
          </SheetScroll>
        </SheetCard>
      )}
    </>
  );
}
