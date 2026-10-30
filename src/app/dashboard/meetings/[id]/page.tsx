import Link from "next/link";
import { notFound } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { CAN_WRITE_LEAD, listLeads } from "@/lib/pipeline";
import { listMatters } from "@/lib/matters";
import { matterLabel } from "@/lib/matters/docket-summary";
import { orgHasModule } from "@/lib/org/modules";
import { relativeTime } from "@/lib/relative-time";
import { formatDuration, formatWhen, getMeeting, linkLabels } from "@/lib/meetings/read";
import { PROVIDER_LABEL } from "@/lib/meetings/types";
import { DraftFollowUpButton, DraftProposalButton, LinkMeetingForm } from "@/components/meetings/MeetingForms";
import type { Metadata } from "next";
import { meetingBackHref } from "@/lib/proposals/consult-row";
import { pageTitle } from "@/lib/ui/page-title";

export const metadata: Metadata = { title: pageTitle("Meeting") };

export const dynamic = "force-dynamic";

/**
 * One meeting: summary, speaker-labelled transcript, attendees, the client it
 * is filed on, and "Draft follow-up" into the approval queue. Read through
 * RLS: another firm's meeting id is simply not found.
 */
export default async function MeetingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ from?: string | string[] }>;
}) {
  const { id } = await params;
  // Only the exact value `proposals` shows the way back; nothing else in the query is ever turned into a link.
  const backToProposals = meetingBackHref((await searchParams)?.from);
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();

  const read = await getMeeting(id);
  if (read.status === "unavailable") {
    return (
      <>
        <Link href="/dashboard/meetings/" className="lx-back">
          ← Meetings
        </Link>
        <div className="lx-card lx-empty-card">
          <h1 className="lx-h2" style={{ fontSize: 25 }}>This meeting couldn&apos;t be loaded</h1>
          <p className="lx-note" style={{ margin: 0 }}>Can&apos;t show this right now. Refresh to try again.</p>
        </div>
      </>
    );
  }
  const m = read.meeting;
  if (!m) notFound();

  const canWrite = CAN_WRITE_LEAD.includes(session.role);
  const [hasAgents, hasProposals, leads, matters, labels] = await Promise.all([
    orgHasModule("agents"),
    orgHasModule("proposals"),
    canWrite ? listLeads().catch(() => []) : Promise.resolve([]),
    canWrite ? listMatters().catch(() => []) : Promise.resolve([]),
    linkLabels(
      [m.lead_id, m.suggested_lead_id].filter((x): x is string => !!x),
      [m.matter_id, m.suggested_matter_id].filter((x): x is string => !!x),
    ),
  ]);
  const leadOptions = leads.map((l) => ({ id: l.id, label: [`${l.first_name} ${l.last_name}`.trim() || l.business_name, l.email].filter(Boolean).join(" · ") }));
  const matterOptions = matters.map((x) => ({ id: x.id, label: `${matterLabel(x)} · ${x.matter_number}` }));

  return (
    <>
      {backToProposals && (
        <Link href={backToProposals} className="lx-back">
          ← Back to Proposals
        </Link>
      )}
      <Link href="/dashboard/meetings/" className="lx-back">
        ← Meetings
      </Link>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">
            {PROVIDER_LABEL[m.provider]} · {formatWhen(m.started_at)} · {formatDuration(m.duration_seconds)}
          </div>
          <h1 className="lx-h1">{m.title}</h1>
          <p className="lx-note" style={{ margin: "6px 0 0" }}>Imported {relativeTime(m.imported_at)}</p>
        </div>
        {m.share_url && (
          <a href={m.share_url} target="_blank" rel="noopener noreferrer" className="lx-btn lx-btn-sec lx-btn-sm">
            Open in {PROVIDER_LABEL[m.provider]} ↗
          </a>
        )}
      </div>

      <div className="lx-split">
        <div className="lx-col">
          <section className="lx-card" style={{ padding: 18 }} aria-labelledby="summary-title">
            <h2 id="summary-title" className="lx-h2" style={{ fontSize: 23, marginBottom: 10 }}>
              Summary
            </h2>
            {m.summary ? (
              <p className="lx-summary">{m.summary}</p>
            ) : (
              <p className="lx-note" style={{ margin: 0 }}>
                {PROVIDER_LABEL[m.provider]}{" "}didn&apos;t provide a summary for this meeting.
              </p>
            )}
          </section>

          <section className="lx-card" style={{ padding: 18 }} aria-labelledby="transcript-title">
            <h2 id="transcript-title" className="lx-h2" style={{ fontSize: 23, marginBottom: 10 }}>
              Transcript
            </h2>
            {m.transcript.length > 0 ? (
              <div className="lx-transcript">
                {m.transcript.map((s, i) => (
                  <div key={i} className="lx-seg">
                    <div className="lx-seg-who">
                      {s.speaker}
                      {s.at && <span className="lx-seg-at">{s.at}</span>}
                    </div>
                    <div className="lx-seg-text">{s.text}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="lx-note" style={{ margin: 0 }}>
                No transcript yet. {PROVIDER_LABEL[m.provider]} may still be processing it; the next import picks it up.
              </p>
            )}
          </section>
        </div>

        <aside className="lx-card lx-aside" style={{ width: 340 }}>
          <div className="lx-label">Client</div>
          {canWrite ? (
            // The form carries the "Linked to ..." text itself, so the linked state and its Change button are one thing.
            <LinkMeetingForm
              meetingId={m.id}
              leadId={m.lead_id}
              matterId={m.matter_id}
              leads={leadOptions}
              matters={matterOptions}
              suggestedLeadId={m.suggested_lead_id}
              suggestedMatterId={m.suggested_matter_id}
              leadLabel={m.lead_id ? (labels.leads.get(m.lead_id) ?? null) : null}
              matterLabel={m.matter_id ? (labels.matters.get(m.matter_id) ?? null) : null}
              suggestedLeadLabel={m.suggested_lead_id ? (labels.leads.get(m.suggested_lead_id) ?? null) : null}
              suggestedMatterLabel={m.suggested_matter_id ? (labels.matters.get(m.suggested_matter_id) ?? null) : null}
              note={m.link_source === "auto" ? "Filed automatically from an attendee's email." : "Linked by your team."}
            />
          ) : m.lead_id || m.matter_id ? (
            <div style={{ display: "grid", gap: 4 }}>
              {m.lead_id && <Link href={`/dashboard/leads/${m.lead_id}/`}>{labels.leads.get(m.lead_id) ?? "Lead"}</Link>}
              {m.matter_id && <Link href={`/dashboard/matters/${m.matter_id}/`}>{labels.matters.get(m.matter_id) ?? "Matter"}</Link>}
              <span className="lx-note">{m.link_source === "auto" ? "Filed automatically from an attendee's email." : "Linked by your team."}</span>
            </div>
          ) : (
            <p className="lx-note" style={{ margin: 0 }}>Not linked to a lead or matter.</p>
          )}

          {canWrite && hasAgents && (
            <>
              <div className="lx-label">Follow-up</div>
              <DraftFollowUpButton meetingId={m.id} />
              {hasProposals && <DraftProposalButton meetingId={m.id} />}
            </>
          )}

          <div className="lx-label">Attendees</div>
          {m.attendees.length > 0 ? (
            <ul className="lx-attendees">
              {m.attendees.map((a, i) => (
                <li key={`${a.email ?? a.name}-${i}`}>
                  <span style={{ color: "var(--ink)" }}>{a.name || a.email}</span>
                  {a.email && a.name && <span className="lx-note">{a.email}</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="lx-note" style={{ margin: 0 }}>
              {m.provider === "zoom" ? "Zoom doesn't list attendees for recordings." : "No attendees recorded."}
            </p>
          )}
        </aside>
      </div>
    </>
  );
}
