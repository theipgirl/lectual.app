import Link from "next/link";
import { notFound } from "next/navigation";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { CAN_MOVE_STAGE, CAN_WRITE_LEAD, getLead, listStages } from "@/lib/pipeline";
import { effectiveTemperature } from "@/lib/intake/effective-temperature";
import { loadTemperatureFacts, type TemperatureFactsRead } from "@/lib/intake/facts";
import { ConsultOutcomeForm } from "@/components/leads/ConsultOutcomeForm";
import { listMemberDirectory } from "@/lib/members/directory";
import { pendingProposals } from "@/lib/agents/proposals";
import { relativeTime } from "@/lib/relative-time";
import { AssignSelect, EditLeadForm, NoteComposer, ProposalCard, StageSelect } from "@/components/leads/LeadForms";
import { LeadTags, PrepConsult } from "@/components/leads/LeadExtras";
import { LeadMattersLine } from "@/components/leads/LeadMatters";
import { loadMattersForLead } from "@/lib/matters/for-lead";
import { AnswersCard } from "@/components/answers/AnswersCard";
import { loadLeadAnswers } from "@/lib/answers/load-answers";
import { Timeline } from "@/components/timeline/Timeline";
import { StageSuggestionCard } from "@/components/leads/StageKeeperControls";
import { pendingStageSuggestions } from "@/lib/stage-keeper/moves";
import { DocumentsCard } from "@/components/files/DocumentsCard";
import { loadDocumentsRead } from "@/lib/files/read";
import { FILE_DELETE_ROLES, FILE_UPLOAD_ROLES } from "@/lib/files/roles";
import VoiceNoteRecorder from "@/components/voice/VoiceNoteRecorder";
import { listTags, tagsForLead } from "@/lib/pipeline/tags";
import { orgHasModule } from "@/lib/org/modules";
import { loadDraftBlock } from "@/lib/consult-proposal/draft-gate";
import { listProposals } from "@/lib/proposals/store";
import { PROPOSAL_STAFF_WRITE_ROLES } from "@/lib/proposals/types";
import { MAX_PASTED_TRANSCRIPT_CHARS } from "@/lib/consult-proposal/types";
import { LeadProposalsCard } from "@/components/leads/LeadProposalsCard";
import { voiceNotePlaybackUrls } from "@/lib/voice/notes";
import { addVoiceNoteAction } from "./actions";
import { meetingsFor } from "@/lib/meetings/read";
import { LinkedMeetings } from "@/components/meetings/LinkedMeetings";
import { ConsultDetailsSection } from "@/components/leads/ConsultDetailsSection";
import { TemperatureCard } from "@/components/leads/TemperatureCard";
import { WaitingOnRebecca } from "@/components/leads/WaitingOnRebecca";
import { ConsultBookedView } from "@/components/calendar/ConsultBookedLine";
import { loadBookedConsult } from "@/lib/calendar/outlook-read";
import { loadPendingApprovalsByLead } from "@/lib/queue/lead-pending";
import type { LeadPendingApprovals } from "@/lib/intake/pending-approvals";
import { SequencesCard, type SequenceRow } from "@/components/leads/SequencesCard";
import { laneView, nextStepForLane } from "@/lib/leads/lane";
import { getFirmTimeZone, getLaneLinks } from "@/lib/org/profile";
import { listLeadEnrollments } from "@/lib/automation/drips";
import { AUTOMATION_STAFF_ROLES } from "@/lib/automation/rules";
import { enrollmentStatusLabel, enrollmentStatusTone } from "@/lib/campaigns/steps";
import { shortDate, stopLine } from "@/lib/campaigns/stops";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();

  // Everything below reads through RLS: another firm's lead id is just "not found".
  const lead = await getLead(id);
  if (!lead) notFound();

  const supabase = await getScopedClient();
  const [hasAgentToolkit, hasProposals, hasMailbox, applied, catalog, meetings] = await Promise.all([
    orgHasModule("agent-toolkit"),
    orgHasModule("proposals"),
    orgHasModule("mailbox"),
    tagsForLead(id).catch(() => []),
    listTags().catch(() => []),
    meetingsFor({ leadId: id }),
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
  const proposalRead = hasProposals
    ? await listProposals({ leadId: id })
        .then((proposals) => ({ status: "ok" as const, proposals }))
        .catch(() => ({ status: "unavailable" as const }))
    : null;
  const proposalCanWrite = CAN_WRITE_LEAD.includes(session.role) && PROPOSAL_STAFF_WRITE_ROLES.includes(session.role);
  const draftBlock = proposalRead && proposalCanWrite ? await loadDraftBlock() : null;
  const rows = activity ?? [];
  const voiceUrls = await voiceNotePlaybackUrls(rows);

  // Lane + next step (SOP Stage 2) and the lead's sequences (SOP rule 1).
  const [{ links, failed: linksFailed }, tz, enrollments, approvals, factsRead, mattersRead, answersRead, documentsRead, consultRead] = await Promise.all([
    getLaneLinks(),
    getFirmTimeZone(),
    listLeadEnrollments(id).catch(() => null),
    // Never throws on an outage (it says `unavailable`); the catch is for the unexpected.
    loadPendingApprovalsByLead().catch((): LeadPendingApprovals => ({ status: "unavailable" })),
    // The same facts the Intake board reads; a failed read leaves the existing rules, never a guessed "cold".
    loadTemperatureFacts([lead], stages).catch((): TemperatureFactsRead => ({ status: "unavailable" })),
    // Never throws (a failed read is `unavailable`), so it can't take the page down.
    loadMattersForLead(lead.id),
    // Three states per source and never throws; a failed read is named on the card, not an empty one.
    loadLeadAnswers(lead.id),
    // Files stored on this lead. Never throws: a failed read is named on the card, not an empty list.
    loadDocumentsRead({ kind: "lead", id: lead.id }, { includeLetters: false }),
    // Outlook consults exist only for a firm with the mailbox module: without it, no read. Never throws (three states).
    hasMailbox ? loadBookedConsult(lead.id) : Promise.resolve(null),
  ]);
  const temperature = effectiveTemperature(lead, stages, new Date(), factsRead.status === "ok" ? factsRead.byLead[lead.id] : undefined);
  const lane = laneView(lead);
  const nextStep = nextStepForLane(lane.effective, links);
  const nurture =
    enrollments && links.nurtureSequenceId ? enrollments.find((e) => e.sequence_id === links.nurtureSequenceId) : undefined;
  const setter = lane.setBy ? members.find((m) => m.userId === lane.setBy) : undefined;
  const sequenceRows: SequenceRow[] | null = enrollments
    ? enrollments.map((e) => ({
        id: e.id,
        sequenceId: e.sequence_id,
        sequenceName: e.sequence_name,
        status: e.status,
        statusLabel: enrollmentStatusLabel(e.status),
        statusTone: enrollmentStatusTone(e.status),
        step: e.status === "active" || e.status === "paused" ? `next: step ${e.current_step + 1}` : "",
        stopLine: e.status === "stopped" ? stopLine({ reason: e.stop_reason, at: e.stopped_at }, tz) : null,
      }))
    : null;
  const canOperate = AUTOMATION_STAFF_ROLES.includes(session.role);
  const renderedAt = new Date().getTime();
  const proposals = pendingProposals(rows);
  const canWrite = CAN_WRITE_LEAD.includes(session.role);
  // The Stage Keeper's suggestions waiting for a person, and who may act on them (the stage-move roles).
  const canMove = CAN_MOVE_STAGE.includes(session.role);
  const stageSuggestions = pendingStageSuggestions(rows);
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
      <Link href="/dashboard/intake/" className="lx-back">
        ← Intake
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
          {consultRead && <ConsultBookedView read={consultRead} timeZone={tz} />}

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

          {stageSuggestions.length > 0 && (
            <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }}>
              <div>
                <div className="lx-label">Stage Keeper · waiting on you</div>
                <h2 className="lx-h2" style={{ fontSize: 23 }}>
                  {stageSuggestions.length} stage suggestion{stageSuggestions.length === 1 ? "" : "s"}
                </h2>
              </div>
              {stageSuggestions.map((s) => (
                <StageSuggestionCard
                  key={s.activityId}
                  leadId={lead.id}
                  suggestion={s}
                  currentStageId={lead.current_stage_id}
                  canDecide={canMove}
                  timeZone={tz}
                />
              ))}
            </section>
          )}

          <TemperatureCard
            leadId={lead.id}
            temperature={temperature}
            view={lane}
            setByName={setter ? (setter.displayName ?? setter.email ?? null) : null}
            setOn={lane.setAt ? shortDate(lane.setAt, tz) : null}
            redFlags={lead.ai_red_flags}
            nextStep={nextStep}
            nextStepIsSuggested={lane.source === "suggestion"}
            nurtureStatus={nurture ? enrollmentStatusLabel(nurture.status) : null}
            linksFailed={linksFailed}
            canWrite={canWrite}
          />
          <AnswersCard read={answersRead} tz={tz} />
          {lead.ai_summary && !lane.suggested && (
            // A triage summary that carries no lane (an older format) is still shown, as the agent's words.
            <section className="lx-card" style={{ padding: 18 }}>
              <div className="lx-label" style={{ marginBottom: 6 }}>
                Triage agent
              </div>
              <p style={{ margin: 0, color: "var(--body)", lineHeight: 1.55 }}>{lead.ai_summary}</p>
            </section>
          )}

          <SequencesCard leadId={lead.id} rows={sequenceRows} canOperate={canOperate} />

          <WaitingOnRebecca leadId={lead.id} approvals={approvals} now={renderedAt} />

          {canWrite && hasAgentToolkit && (
            <details id="prep-consult" className="lx-card lx-disclosure">
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

          {canWrite && (
            <section className="lx-card" style={{ padding: 18 }}>
              <ConsultOutcomeForm leadId={lead.id} />
            </section>
          )}

          <LinkedMeetings read={meetings} />

          {proposalRead && (
            <LeadProposalsCard
              leadId={lead.id}
              read={proposalRead}
              canWrite={proposalCanWrite}
              draftBlock={draftBlock}
              maxChars={MAX_PASTED_TRANSCRIPT_CHARS}
            />
          )}

          <ConsultDetailsSection leadId={lead.id} canWrite={canWrite} />

          <DocumentsCard
            parent={{ kind: "lead", id: lead.id }}
            read={documentsRead}
            directory={members.map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "" }))}
            canUpload={FILE_UPLOAD_ROLES.includes(session.role)}
            canDelete={FILE_DELETE_ROLES.includes(session.role)}
          />

          <section className="lx-card" style={{ padding: 18 }}>
            <h2 className="lx-h2" style={{ fontSize: 23, marginBottom: 10 }}>
              Timeline
            </h2>
            {canWrite && (
              <div style={{ marginBottom: 14 }}>
                <VoiceNoteRecorder target={{ kind: "lead", id: lead.id }} action={addVoiceNoteAction} />
              </div>
            )}
            <Timeline rows={rows} mediaUrls={voiceUrls} timeZone={tz} undo={{ leadId: lead.id, canMove, currentStageId: lead.current_stage_id }} />
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
          <LeadMattersLine read={mattersRead} />
        </aside>
      </div>
    </>
  );
}
