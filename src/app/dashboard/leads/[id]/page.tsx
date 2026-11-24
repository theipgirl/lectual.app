import type { Metadata } from "next";
import { stageDisplayName } from "@/lib/matters/list-view";
import { notFound, redirect } from "next/navigation";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { MailingAddressCard } from "@/components/loe/MailingAddressCard";
import { loadSignedAddress } from "@/lib/loe/signed-address";
import { CAN_MOVE_STAGE, CAN_WRITE_LEAD, getLead, listStages } from "@/lib/pipeline";
import { effectiveTemperature } from "@/lib/intake/effective-temperature";
import { loadTemperatureFacts, type TemperatureFactsRead } from "@/lib/intake/facts";
import { ConsultOutcomeForm } from "@/components/leads/ConsultOutcomeForm";
import { listMemberDirectory } from "@/lib/members/directory";
import { pendingProposals } from "@/lib/agents/proposals";
import { relativeTime } from "@/lib/relative-time";
import "@/components/leads/lead-page.css";
import { LeadStatusRow } from "@/components/leads/LeadStatusRow";
import { ContactActions } from "@/components/leads/ContactActions";
import { NeedsAttentionCard } from "@/components/leads/NeedsAttentionCard";
import { ComposerTabs } from "@/components/leads/ComposerTabs";
import { CollapsibleAside } from "@/components/leads/CollapsibleAside";
import { needsAttention } from "@/lib/leads/needs-attention";
import { LANE_LABEL } from "@/lib/leads/lane";
import { temperaturePill } from "@/lib/intake/temperature-pill";
import { AssignSelect, EditLeadForm, NoteComposer, ProposalCard, StageSelect } from "@/components/leads/LeadForms";
import { LeadTags } from "@/components/leads/LeadExtras";
import { ConsultPrepCard } from "@/components/leads/ConsultPrepCard";
import { loadConsultPrepCard } from "@/lib/consult-prep/card-load";
import { canRerunConsultPrep } from "@/lib/consult-prep/roles";
import { canSeeSetup } from "@/lib/setup/roles";
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
import { TopCard } from "@/components/leads/TopCard";
import { TopCardFrame } from "@/components/leads/TopCardFrame";
import { WhatLectualDid } from "@/components/leads/WhatLectualDid";
import { OtherApprovals } from "@/components/leads/OtherApprovals";
import { FourFacts } from "@/components/leads/FourFacts";
import { loadLeadStepFacts, type LeadStepLoad } from "@/lib/lead-step/load";
import { buildLeadStepView } from "@/lib/lead-step/view-model";
import { ConsultBookedView } from "@/components/calendar/ConsultBookedLine";
import { recordPageTitle } from "@/lib/ui/page-title";
import { AUTOMATIC_STAGE_MOVES, BLANK, FIRST_READ, LAST_CONTACT, FROM_THEIR_EMAILS, INTAKE_NAME, LEAD_STEP_CANT_SHOW_NEEDS, LEAD_STEP_DID_UNAVAILABLE, LEAD_MERGED_INTO, MERGE_DONE, MERGE_HISTORY_PARTIAL, MERGE_OWN_ROWS_UNAVAILABLE } from "@/lib/ui/words";
import { mergedSetFor, resolveLeadId } from "@/lib/leads/live";
import { mergeNotice, mergedFromRedirect } from "@/lib/leads/merge-links";
import { loadBookedConsult } from "@/lib/calendar/outlook-read";
import { loadBookedLawmaticsConsult } from "@/lib/calendar/lawmatics-read";
import { mergeBookedConsults } from "@/lib/calendar/booked-merge";
import { SequencesCard, type SequenceRow } from "@/components/leads/SequencesCard";
import { laneView, nextStepForLane } from "@/lib/leads/lane";
import { getFirmTimeZone, getLaneLinks } from "@/lib/org/profile";
import { listLeadEnrollments } from "@/lib/automation/drips";
import { AUTOMATION_STAFF_ROLES } from "@/lib/automation/rules";
import { enrollmentStatusLabel, enrollmentStatusTone } from "@/lib/campaigns/steps";
import { shortDate, stopLine } from "@/lib/campaigns/stops";
import { intakeListHref } from "@/lib/intake/list-href";
import { PageHeader } from "@/components/ui/PageHeader";
import { Notice } from "@/components/ui/Notice";
import { LoadFailedLine } from "@/components/ui/LoadFailed";

/** Tab title: the lead's name through the scoped getter; "Lead" when the read fails or finds nothing. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: await recordPageTitle(async () => {
      const lead = await getLead(id);
      if (!lead) return null;
      return [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || lead.business_name;
    }, "Lead"),
  };
}

/** The one plain line of record facts under the name: each fact once (a business name that is also the mark is shown once). */
function leadDetailsLine(lead: { business_name?: string | null; email?: string | null; phone?: string | null; mark_text?: string | null }): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const raw of [lead.business_name, lead.email, lead.phone, lead.mark_text]) {
    const part = raw?.trim();
    if (!part || seen.has(part.toLowerCase())) continue;
    seen.add(part.toLowerCase());
    parts.push(part);
  }
  return parts.join(" · ");
}

export default async function LeadPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const session = await resolveFirmSession();
  if (session.kind !== "ok") notFound();

  // Everything below reads through RLS: another firm's lead id is just "not found".
  const lead = await getLead(id);
  if (!lead) notFound();

  const supabase = await getScopedClient();
  // A merged lead (lectual 0107) is not a page of its own: its link goes to the lead it was merged into.
  if (lead.merged_into_id) {
    const followed = await resolveLeadId(supabase, id);
    redirect(mergedFromRedirect(followed.status === "ok" ? followed.id : lead.merged_into_id, id));
  }
  // The history that stays on merged leads (timeline, files, proposals) is read with this lead's own.
  const mergedSet = await mergedSetFor(supabase, id);
  const mergedIds = mergedSet.ids.filter((x) => x !== id);
  const notice = mergeNotice({ merged: sp.merged, from: sp.from }, mergedIds);
  const [hasProposals, hasMailbox, applied, catalog, meetings] = await Promise.all([
    orgHasModule("proposals"),
    orgHasModule("mailbox"),
    tagsForLead(id).catch(() => []),
    listTags().catch(() => []),
    meetingsFor({ leadId: id }),
  ]);
  const [stages, membersRead, { data: activity }] = await Promise.all([
    listStages(),
    // Null on a failed read (never an empty team): the step forms then draw no picker and post no assignee.
    listMemberDirectory().catch(() => null),
    (mergedIds.length
      ? supabase.from("crm_activity").select("id, lead_id, type, actor_type, created_at, payload").in("lead_id", mergedSet.ids)
      : supabase.from("crm_activity").select("id, lead_id, type, actor_type, created_at, payload").eq("lead_id", id)
    )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  const members = membersRead ?? [];
  const proposalRead = hasProposals
    ? await listProposals(mergedIds.length ? { leadIds: mergedSet.ids } : { leadId: id })
        .then((proposals) => ({ status: "ok" as const, proposals }))
        .catch(() => ({ status: "unavailable" as const }))
    : null;
  const proposalCanWrite = CAN_WRITE_LEAD.includes(session.role) && PROPOSAL_STAFF_WRITE_ROLES.includes(session.role);
  const draftBlock = proposalRead && proposalCanWrite ? await loadDraftBlock() : null;
  const rows = activity ?? [];
  // What a person can act on (suggestions, proposals from email) is this lead's OWN rows only. With leads merged into
  // it, they are read on their own, so the 100-row cap over the merged history can't push them out.
  const ownRead = mergedIds.length
    ? await supabase
        .from("crm_activity")
        .select("id, lead_id, type, actor_type, created_at, payload")
        .eq("lead_id", id)
        .order("created_at", { ascending: false })
        .limit(100)
        .then(
          (r) => (r.error ? null : (r.data ?? [])),
          () => null,
        )
    : rows;
  // Three states: rows, none, or couldn't be read (said on the page, never shown as "nothing waiting").
  const ownRowsFailed = ownRead === null;
  const ownRows = ownRead ?? [];
  const voiceUrls = await voiceNotePlaybackUrls(rows);

  // Lane + next step (SOP Stage 2) and the lead's sequences (SOP rule 1).
  const [{ links, failed: linksFailed }, tz, enrollments, stepLoad, factsRead, mattersRead, answersRead, documentsRead, consultRead, mailingRead, prepCard] = await Promise.all([
    getLaneLinks(),
    getFirmTimeZone(),
    listLeadEnrollments(id).catch(() => null),
    // The top card, the four facts and "What Lectual did" are decided from these (src/lib/lead-step/). Never throws; the catch is for the unexpected.
    loadLeadStepFacts(lead.id).catch((): LeadStepLoad => ({ status: "unavailable" })),
    // The same facts the Intake board reads; a failed read leaves the existing rules, never a guessed "cold".
    loadTemperatureFacts([lead], stages).catch((): TemperatureFactsRead => ({ status: "unavailable" })),
    // Never throws (a failed read is `unavailable`), so it can't take the page down.
    loadMattersForLead(lead.id),
    // Three states per source and never throws; a failed read is named on the card, not an empty one.
    loadLeadAnswers(lead.id),
    // Files stored on this lead. Never throws: a failed read is named on the card, not an empty list.
    loadDocumentsRead({ kind: "lead", id: lead.id, mergedIds }, { includeLetters: false }),
    // Two reads, the earliest booking shown: Outlook only with the mailbox module, Lawmatics whenever it is connected
    // (not behind Mailboxes). Never throws (three states each; null = not read).
    Promise.all([hasMailbox ? loadBookedConsult(lead.id) : Promise.resolve(null), loadBookedLawmaticsConsult(lead.id).catch(() => ({ status: "unavailable" as const }))]).then(mergeBookedConsults),
    // The address the client gave when they signed their letter: staff roles only (null = not asked). Never throws (three states).
    loadSignedAddress(session.role, { leadId: lead.id }),
    // The Consult prep card: markers, sends, recipients and the stored brief. Three states each; never throws.
    getFirmTimeZone().then((zone) => loadConsultPrepCard({ leadIds: mergedSet.ids, adminTier: canSeeSetup(session.role), tz: zone })),
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
  const proposals = pendingProposals(ownRows);
  const canWrite = CAN_WRITE_LEAD.includes(session.role);
  // The automatic stage moves suggestions waiting for a person, and who may act on them (the stage-move roles).
  const canMove = CAN_MOVE_STAGE.includes(session.role);
  const stageSuggestions = pendingStageSuggestions(ownRows);
  const name = `${lead.first_name} ${lead.last_name}`.trim() || lead.email;
  const current: Record<string, string | null> = {
    business_name: lead.business_name,
    phone: lead.phone,
    website: lead.website,
    mark_text: lead.mark_text,
    practice_area: lead.practice_area,
  };

  const stageRaw = stages.find((s) => s.id === lead.current_stage_id)?.name ?? null;
  const stageName = stageRaw === null ? null : stageDisplayName(stageRaw);
  const owner = lead.assigned_to ? members.find((m) => m.userId === lead.assigned_to) : undefined;
  const ownerName = owner ? (owner.displayName ?? owner.email ?? null) : null;
  const showAttention = needsAttention({
    leadId: lead.id,
    consult: consultRead,
    clientEmailProposals: proposals.length,
    stageSuggestions: stageSuggestions.length,
  });

  // The engine's view: exactly one top card. A lead the engine couldn't read is the "couldn't load" card, never a calm one.
  // A view that can't be built is the same couldn't-load card, never the page's error screen.
  let step: ReturnType<typeof buildLeadStepView> | null = null;
  if (stepLoad.status === "ok") {
    try {
      step = buildLeadStepView(stepLoad.facts);
    } catch {
      step = null;
    }
  }
  const yoursId = step?.top.kind === "yours" ? step.top.taskId : null;
  const yoursTask = yoursId && stepLoad.status === "ok" && stepLoad.facts.tasks.status === "ok" ? stepLoad.facts.tasks.value.find((t) => t.id === yoursId) : undefined;
  const stepMembers = membersRead ? membersRead.map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "Teammate" })) : null;

  return (
    <>
      <PageHeader
        back={{ href: intakeListHref(), label: INTAKE_NAME }}
        title={name}
        tour="lead-head"
        details={leadDetailsLine(lead)}
        actions={
          <>
            <ContactActions phone={lead.phone} email={lead.email} />
            {canWrite && (
              <div className="lx-head-selects">
                <StageSelect leadId={lead.id} stageId={lead.current_stage_id} stages={stages.map((s) => ({ id: s.id, name: s.name }))} />
                <AssignSelect leadId={lead.id} assignedTo={lead.assigned_to} members={members.map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "Teammate" }))} />
              </div>
            )}
          </>
        }
      />

      {notice && (
        <Notice tone={notice === "merged" ? "ok" : "mute"} role="status">
          {notice === "merged" ? MERGE_DONE : LEAD_MERGED_INTO(name)}
        </Notice>
      )}
      {ownRowsFailed && (
        <LoadFailedLine>{MERGE_OWN_ROWS_UNAVAILABLE}</LoadFailedLine>
      )}
      {mergedSet.status === "unavailable" && (
        <LoadFailedLine>{MERGE_HISTORY_PARTIAL}</LoadFailedLine>
      )}

      <LeadStatusRow
        stageName={stageName}
        temperatureLabel={temperature.value ? (temperaturePill(temperature)?.text ?? LANE_LABEL[temperature.value]) : null}
        ownerName={ownerName}
        lastInboundAt={lead.last_inbound_at}
        now={renderedAt}
        hideLastHeard={!!step}
      />

      <div className="ls-top">
        <TopCardFrame>
          <TopCard
            leadId={lead.id}
            view={step ? step.top : { kind: "couldnt-load", text: LEAD_STEP_CANT_SHOW_NEEDS }}
            canWriteSteps={canWrite}
            members={stepMembers}
            yoursDueDate={yoursTask?.dueAt ? yoursTask.dueAt.slice(0, 10) : null}
          />
        </TopCardFrame>
        {step && <OtherApprovals queue={step.queue} />}
        <WhatLectualDid leadId={lead.id} did={step ? step.did : { status: "unavailable", text: LEAD_STEP_DID_UNAVAILABLE }} />
        {step && <FourFacts facts={step.facts} />}
      </div>

      <div className="lx-split lx-split-lead">
        <div className="lx-col">
          {showAttention && (
            <NeedsAttentionCard>
              {consultRead && <ConsultBookedView read={consultRead} timeZone={tz} bare />}

              {proposals.length > 0 && (
                <div className="lx-grid-12">
                  <div>
                    <div className="lx-label">{FROM_THEIR_EMAILS} · waiting on you</div>
                    <h3 className="lx-h3">
                      {proposals.length} proposal{proposals.length === 1 ? "" : "s"} from client email
                    </h3>
                  </div>
                  {proposals.map((p) => (
                    <ProposalCard key={p.activityId} leadId={lead.id} proposal={p} current={current} canWrite={canWrite} />
                  ))}
                </div>
              )}

              {stageSuggestions.length > 0 && (
                <div className="lx-grid-12">
                  <div>
                    <div className="lx-label">{AUTOMATIC_STAGE_MOVES} · waiting on you</div>
                    <h3 className="lx-h3">
                      {stageSuggestions.length} stage suggestion{stageSuggestions.length === 1 ? "" : "s"}
                    </h3>
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
                </div>
              )}
            </NeedsAttentionCard>
          )}

          {canWrite && (
            <section className="lx-card lx-pad" aria-label="Add to the timeline">
              <ComposerTabs
                text={<NoteComposer leadId={lead.id} />}
                voice={<VoiceNoteRecorder target={{ kind: "lead", id: lead.id }} action={addVoiceNoteAction} />}
              />
            </section>
          )}

          <section className="lx-card lx-pad" data-tour="lead-timeline">
            <h2 className="lx-h2" style={{ marginBottom: 10 }}>
              Timeline
            </h2>
            <Timeline rows={rows} mediaUrls={voiceUrls} timeZone={tz} undo={{ leadId: lead.id, canMove, currentStageId: lead.current_stage_id }} />
          </section>

          <ConsultPrepCard data={prepCard} leadId={lead.id} canRerun={canRerunConsultPrep(session.role)} adminTier={canSeeSetup(session.role)} />

          <ConsultDetailsSection leadId={lead.id} canWrite={canWrite} timeZone={tz} />

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

          {canWrite && (
            <details className="lx-card lx-disclosure" id="log-consult-outcome">
              <summary>Log a consult outcome</summary>
              <div className="lx-disclosure-body">
                <ConsultOutcomeForm leadId={lead.id} />
              </div>
            </details>
          )}

          <AnswersCard read={answersRead} tz={tz} />

          <DocumentsCard
            parent={{ kind: "lead", id: lead.id }}
            read={documentsRead}
            directory={members.map((m) => ({ userId: m.userId, name: m.displayName ?? m.email ?? "" }))}
            canUpload={FILE_UPLOAD_ROLES.includes(session.role)}
            canDelete={FILE_DELETE_ROLES.includes(session.role)}
          />

          <SequencesCard leadId={lead.id} rows={sequenceRows} canOperate={canOperate} />

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
          {lead.ai_summary && !lane.suggested && (
            // A first-read summary that carries no temperature (an older format) is still shown, as the assistant's words.
            <section className="lx-card lx-pad">
              <div className="lx-label" style={{ marginBottom: 6 }}>
                {FIRST_READ}
              </div>
              <p className="lx-note">{lead.ai_summary}</p>
            </section>
          )}
        </div>

        <aside className="lx-card lx-aside">
          <CollapsibleAside>
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
              <span>{LAST_CONTACT}</span>
              <span>{lead.last_inbound_at ? relativeTime(lead.last_inbound_at, undefined, tz) : BLANK}</span>
            </div>
            <div className="lx-meta">
              <span>Last reached out</span>
              <span>{lead.last_outbound_at ? relativeTime(lead.last_outbound_at, undefined, tz) : BLANK}</span>
            </div>
            <div className="lx-meta">
              <span>Came from</span>
              <span>{[lead.referral_source, lead.referral_detail].filter(Boolean).join(" — ") || BLANK}</span>
            </div>
            <MailingAddressCard read={mailingRead} />
            <LeadMattersLine read={mattersRead} />
          </CollapsibleAside>
        </aside>
      </div>
    </>
  );
}
