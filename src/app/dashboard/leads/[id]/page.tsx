import Link from "next/link";
import { notFound } from "next/navigation";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { CAN_WRITE_LEAD, getLead, listStages } from "@/lib/pipeline";
import { listMemberDirectory } from "@/lib/members/directory";
import { pendingProposals } from "@/lib/agents/proposals";
import { relativeTime } from "@/lib/relative-time";
import { AssignSelect, EditLeadForm, NoteComposer, ProposalCard, StageSelect } from "@/components/leads/LeadForms";
import { LeadTags, PrepConsult } from "@/components/leads/LeadExtras";
import { Timeline } from "@/components/timeline/Timeline";
import VoiceNoteRecorder from "@/components/voice/VoiceNoteRecorder";
import { listTags, tagsForLead } from "@/lib/pipeline/tags";
import { orgHasModule } from "@/lib/org/modules";
import { voiceNotePlaybackUrls } from "@/lib/voice/notes";
import { addVoiceNoteAction } from "./actions";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();

  // Everything below reads through RLS: another firm's lead id is just "not found".
  const lead = await getLead(id);
  if (!lead) notFound();

  const supabase = await getScopedClient();
  const [hasAgentToolkit, applied, catalog] = await Promise.all([
    orgHasModule("agent-toolkit"),
    tagsForLead(id).catch(() => []),
    listTags().catch(() => []),
  ]);
  const [stages, members, { data: activity }] = await Promise.all([
    listStages(),
    listMemberDirectory().catch(() => []),
    supabase
      .from("crm_activity")
      .select("id, type, actor_type, created_at, payload")
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const rows = activity ?? [];
  const voiceUrls = await voiceNotePlaybackUrls(rows);
  const proposals = pendingProposals(rows);
  const canWrite = CAN_WRITE_LEAD.includes(session.role);
  const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
  const current: Record<string, string | null> = {
    business_name: lead.business_name,
    phone: lead.phone,
    website: lead.website,
    mark_text: lead.mark_text,
    practice_area: lead.practice_area,
  };

  return (
    <>
      <Link href="/dashboard/leads/" className="lx-back">
        ← Leads
      </Link>
      <div className="lx-page-head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="lx-label">{lead.business_name ?? "Lead"}</div>
          <h1 className="lx-h1">{name}</h1>
          <p className="lx-note" style={{ margin: "6px 0 0" }}>
            {lead.email}
            {lead.phone ? ` · ${lead.phone}` : ""}
            {lead.mark_text ? ` · ${lead.mark_text}` : ""}
          </p>
        </div>
        {canWrite && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <StageSelect leadId={lead.id} stageId={lead.current_stage_id} stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
            <AssignSelect leadId={lead.id} assignedTo={lead.assigned_to} members={members.map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "Teammate" }))} />
          </div>
        )}
      </div>

      <div className="lx-split">
        <div className="lx-col">
          {proposals.length > 0 && (
            <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }}>
              <div>
                <div className="lx-label">Email intel · waiting on you</div>
                <h2 className="lx-h2" style={{ fontSize: 23 }}>
                  {proposals.length} proposal{proposals.length === 1 ? "" : "s"} from client email
                </h2>
              </div>
              {proposals.map((p) => (
                <ProposalCard key={p.activityId} leadId={lead.id} proposal={p} current={current} canWrite={canWrite} />
              ))}
            </section>
          )}

          {lead.ai_summary && (
            <section className="lx-card" style={{ padding: 18 }}>
              <div className="lx-label" style={{ marginBottom: 6 }}>
                Triage agent
              </div>
              <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.55 }}>{lead.ai_summary}</p>
              {lead.ai_red_flags.length > 0 && (
                <ul className="lx-flags">
                  {lead.ai_red_flags.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {canWrite && hasAgentToolkit && (
            <details className="lx-card lx-disclosure">
              <summary>Prep this consult</summary>
              <div style={{ padding: "0 18px 18px" }}>
                <PrepConsult leadId={lead.id} practiceArea={lead.practice_area} />
              </div>
            </details>
          )}

          {canWrite && (
            <section className="lx-card" style={{ padding: 18 }}>
              <NoteComposer leadId={lead.id} />
            </section>
          )}

          <section className="lx-card" style={{ padding: 18 }}>
            <h2 className="lx-h2" style={{ fontSize: 23, marginBottom: 10 }}>
              Timeline
            </h2>
            {canWrite && (
              <div style={{ marginBottom: 14 }}>
                <VoiceNoteRecorder target={{ kind: "lead", id: lead.id }} action={addVoiceNoteAction} />
              </div>
            )}
            <Timeline rows={rows} mediaUrls={voiceUrls} />
          </section>
        </div>

        <aside className="lx-card lx-aside" style={{ width: 340 }}>
          <div className="lx-label">Tags</div>
          <LeadTags
            leadId={lead.id}
            applied={applied.map((t) => ({ id: t.id, label: t.label, color: t.color }))}
            catalog={catalog.map((t) => ({ id: t.id, label: t.label, color: t.color }))}
            canWrite={canWrite}
          />
          <div className="lx-label">Details</div>
          {canWrite ? (
            <EditLeadForm
              leadId={lead.id}
              values={{ firstName: lead.first_name, lastName: lead.last_name, email: lead.email, phone: lead.phone, businessName: lead.business_name, website: lead.website }}
            />
          ) : (
            <p className="lx-note">Your role can view this lead but not change it.</p>
          )}
          <div className="lx-meta">
            <span>Last heard from</span>
            <span>{lead.last_inbound_at ? relativeTime(lead.last_inbound_at) : "—"}</span>
          </div>
          <div className="lx-meta">
            <span>Last reached out</span>
            <span>{lead.last_outbound_at ? relativeTime(lead.last_outbound_at) : "—"}</span>
          </div>
          <div className="lx-meta">
            <span>Came from</span>
            <span>{[lead.referral_source, lead.referral_detail].filter(Boolean).join(" — ") || "—"}</span>
          </div>
        </aside>
      </div>
    </>
  );
}
