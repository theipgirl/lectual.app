import Link from "next/link";
import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { Pill } from "@/components/ui/Pill";
import { DocumentsCard } from "@/components/files/DocumentsCard";
import { ComposerTabs } from "@/components/leads/ComposerTabs";
import { NoteComposer } from "@/components/leads/LeadForms";
import { FourFacts } from "@/components/leads/FourFacts";
import { TopCard } from "@/components/leads/TopCard";
import { TopCardFrame } from "@/components/leads/TopCardFrame";
import { WhatLectualDid } from "@/components/leads/WhatLectualDid";
import { MatterNoteComposer } from "@/components/matters/MatterEdits";
import { Timeline } from "@/components/timeline/Timeline";
import VoiceNoteRecorder from "@/components/voice/VoiceNoteRecorder";
import { addVoiceNoteAction as addLeadVoiceNote } from "@/app/dashboard/leads/[id]/actions";
import { addVoiceNoteAction as addMatterVoiceNote } from "@/app/dashboard/matters/[id]/actions";
import { FILE_DELETE_ROLES } from "@/lib/files/roles";
import { voiceNotePlaybackUrls } from "@/lib/voice/notes";
import { buildOpenedCard, withMatterMoveStages, type OpenedCardView, type RecordCardLoad } from "@/lib/record-card/model";
import { loadRecordCard } from "@/lib/record-card/load";
import { closeHref, openHref, type CardRef, type CurrentParams } from "@/lib/record-card/open";
import {
  LEAD_STEP_COULDNT_LOAD,
  RECORD_CARD_CALL,
  RECORD_CARD_CONTACT,
  RECORD_CARD_CONTACT_NOTE,
  RECORD_CARD_DEADLINE_HEAD,
  RECORD_CARD_DEADLINE_NOTE,
  RECORD_CARD_EMAIL,
  RECORD_CARD_MENU_OPEN,
  RECORD_CARD_NOTE_HEADING,
  RECORD_CARD_NO_CONTACT,
  RECORD_CARD_NO_PROPOSAL,
  RECORD_CARD_OPEN_PROPOSAL,
  RECORD_CARD_OPENED_LABEL,
  RECORD_CARD_OWNER,
  RECORD_CARD_PROPOSAL,
  RECORD_CARD_SOURCE,
  RECORD_CARD_STAGE,
  RECORD_CARD_TAGS,
  RECORD_CARD_TIMELINE,
} from "@/lib/ui/words";
import { CardMenu, OwnerPick, SourcePick, StagePick, TempPill } from "./controls";
import { RenameForm, StepsChecklist, TagsEditor } from "./opened-parts";
import "./record-card.css";

type Ok = Exclude<OpenedCardView, { status: "not-found" } | { status: "unavailable" }>;

function Chips({ view }: { view: Ok }) {
  const c = view.card;
  return (
    <div className="rc-chips">
      <span className="rc-ctl">
        <span className="lx-label">{RECORD_CARD_STAGE}</span>
        <StagePick kind={c.kind} id={c.id} name={c.name} stage={c.stage} />
      </span>
      {c.temperature && <TempPill leadId={c.id} name={c.name} control={c.temperature} />}
      <span className="rc-ctl">
        <span className="lx-label">{RECORD_CARD_SOURCE}</span>
        <SourcePick kind={c.kind} id={c.id} name={c.name} value={c.source.value} choices={c.source.choices} />
      </span>
      <span className="rc-ctl">
        <span className="lx-label">{RECORD_CARD_OWNER}</span>
        <OwnerPick kind={c.kind} id={c.id} name={c.name} owner={c.owner} withName />
      </span>
      {c.approvals &&
        (c.approvals.href ? (
          <Link href={c.approvals.href} className="lx-pill lx-pill-warn rc-attn">
            {c.approvals.text}
          </Link>
        ) : (
          <Pill tone="mute">{c.approvals.text}</Pill>
        ))}
    </div>
  );
}

function TimelineBlock({ view, tz, urls, leadUndo }: { view: Ok; tz: string; urls: Record<string, string>; leadUndo?: { leadId: string; canMove: boolean; currentStageId: string | null } }) {
  if (view.timeline.status !== "ok") return <LoadFailedLine refresh={false}>{LEAD_STEP_COULDNT_LOAD}</LoadFailedLine>;
  // The same rows the lead and matter pages hand the timeline (crm_activity), read by the card's loader.
  const rows = view.timeline.value.rows as unknown as Parameters<typeof Timeline>[0]["rows"];
  return <Timeline rows={rows} mediaUrls={urls} timeZone={tz} undo={leadUndo} />;
}

function Docs({ view, role, directory, refresh }: { view: Ok; role: string; directory: { userId: string; name: string }[]; refresh?: boolean }) {
  if (view.documents.status !== "ok") return <LoadFailedLine refresh={false}>{LEAD_STEP_COULDNT_LOAD}</LoadFailedLine>;
  return (
    <DocumentsCard
      parent={{ kind: view.kind, id: view.card.id }}
      read={view.documents.value}
      directory={directory}
      canUpload={view.card.edits.upload}
      canDelete={(FILE_DELETE_ROLES as readonly string[]).includes(role)}
      {...(refresh ? { refreshAfterUpload: true } : {})}
    />
  );
}

/**
 * What the Weekly review adds when it opens a record in this card (it has no drawer of its own any more). Intake and Matters
 * pass nothing and their card is exactly as before.
 */
export type RecordCardReview = {
  /** The review row's facts (waiting on, last contact, last changed, USPTO deadline, proposal) and, for a lead, Lost / Nurture: first in the side column. */
  aside: ReactNode;
  /**
   * The review's "Log what happened" form, in place of the text composer: the same plain note, through the review's own action,
   * which refreshes the review. Drawn only where the card already draws a composer (the role's `notes` edit).
   */
  note: ReactNode;
};

type StepAssigneesProp = { members: { userId: string; name: string }[]; byTask: Record<string, string | null>; forNew: string | null };

/** Who each open step is assigned to, from the rows the loader already read. Null when the team list can't be read: a select of nobody would clear an assignee. */
function stepAssignees(load: Extract<RecordCardLoad, { status: "ok" }>, directory: { userId: string; name: string }[]): StepAssigneesProp | null {
  if (load.members.status !== "ok") return null;
  const tasks =
    load.kind === "matter"
      ? load.tasks.status === "ok"
        ? load.tasks.value
        : []
      : load.leadStep.status === "ok" && load.leadStep.facts.tasks.status === "ok"
        ? load.leadStep.facts.tasks.value
        : [];
  const byTask: Record<string, string | null> = {};
  for (const t of tasks) byTask[t.id] = t.assigneeId ?? null;
  const owner = load.kind === "matter" ? load.matter.assigned_to : load.lead.assigned_to;
  return { members: directory, byTask, forNew: tasks[0]?.assigneeId ?? owner ?? null };
}

/**
 * The opened card (`?open=`): the kit's Dialog, centred from 900px and a full-screen sheet below. It is SERVER rendered from
 * the param: the record is re-read through the scoped client (`loadRecordCard`), a foreign or missing id says "couldn't be
 * found" with no field of the record, a failed read says so. Esc, Back and the close button all follow the close LINK.
 * Nothing here sends: Call and Email open the person's own apps.
 */
export async function RecordCardHost({
  open,
  path,
  params,
  duplicateOf,
  load: given,
  moveStages,
  review,
}: {
  open: CardRef | null;
  path: string;
  params: CurrentParams;
  duplicateOf?: string | null;
  load?: RecordCardLoad;
  /** Matters page only: the stages its board and card menus offer (`matterMoveStages`). Leads and a failed stage read keep the loader's list. */
  moveStages?: readonly { id: string; label: string }[];
  /** The Weekly review's facts and actions (see `RecordCardReview`). Left out on Intake and Matters. */
  review?: RecordCardReview;
}) {
  if (!open) return null;
  const loaded = given ?? (await loadRecordCard(open, { duplicateOf }));
  const load = withMatterMoveStages(loaded, moveStages);
  // From the review a lead may also be moved to a lost stage, as its old drawer allowed (never won: moveTargets and the action refuse it).
  const view = buildOpenedCard(load, review ? { path, params, lostShown: true } : { path, params });
  if (view.status !== "ok" || load.status !== "ok") {
    return (
      <Dialog closeHref={view.status === "ok" ? closeHref(path, params) : view.closeHref} title={RECORD_CARD_OPENED_LABEL} titleId="record-card-title" size="sm">
        {view.status === "unavailable" ? (
          <LoadFailedLine refresh={false}>{view.text}</LoadFailedLine>
        ) : (
          <p className="lx-note" role="status">
            {view.status === "not-found" ? view.text : ""}
          </p>
        )}
      </Dialog>
    );
  }
  const role = load.role;
  const directory = load.members.status === "ok" ? load.members.value.map((m) => ({ userId: m.userId, name: m.name })) : [];
  const tz = load.timeZone;
  const c = view.card;
  // Voice notes play from short-lived signed URLs minted through the caller's own scoped client; a failure just shows the transcript.
  const urls: Record<string, string> =
    view.timeline.status === "ok" ? await voiceNotePlaybackUrls(view.timeline.value.rows as unknown as Parameters<typeof voiceNotePlaybackUrls>[0]).catch(() => ({})) : {};
  const stepsHere = openHref(path, params, { kind: view.kind, id: c.id }) + "#card-steps";
  const assignees = review ? stepAssignees(load, directory) : null;

  if (view.kind === "matter") {
    const matter = load.kind === "matter" ? load.matter : null;
    return (
      <Dialog closeHref={view.closeHref} title={c.name} titleId={view.titleId} size="lg" className="rc-card">
        <div className="rc-head">
          {c.sub && <p className="lx-note">{c.sub}</p>}
          <p className="lx-note">{matter?.matter_number}</p>
          <Chips view={view} />
          <span className="rc-ctl">
            <RenameForm kind="matter" id={c.id} title={matter?.title ?? c.name} canEdit={c.edits.title} />
            <CardMenu card={c} stepHref={stepsHere} />
          </span>
        </div>
        <div className="rc-cols">
          <div className="rc-main">
            <StepsChecklist kind="matter" id={c.id} steps={view.steps} {...(assignees ? { assignees } : {})} />
            {c.edits.notes && (
              <section className="rc-sec" aria-label={RECORD_CARD_NOTE_HEADING}>
                <div className="lx-composer">
                  {review ? review.note : <MatterNoteComposer matterId={c.id} />}
                  <VoiceNoteRecorder target={{ kind: "matter", id: c.id }} action={addMatterVoiceNote} />
                </div>
              </section>
            )}
            <section className="rc-sec">
              <h3 className="lx-label">{RECORD_CARD_TIMELINE}</h3>
              <TimelineBlock view={view} tz={tz} urls={urls} />
            </section>
          </div>
          <div className="rc-side">
            {review?.aside}
            <section className="rc-sec" aria-label={RECORD_CARD_DEADLINE_HEAD}>
              <h3 className="lx-label">{RECORD_CARD_DEADLINE_HEAD}</h3>
              {view.deadline.status === "unavailable" ? (
                <LoadFailedLine refresh={false}>{view.deadline.text}</LoadFailedLine>
              ) : view.deadline.status === "none" ? (
                <p className="lx-note">{view.deadline.text}</p>
              ) : (
                <p>
                  {view.deadline.text} <Pill tone={view.deadline.confirmed ? "ok" : "mute"}>{view.deadline.marker}</Pill>
                </p>
              )}
              <p className="lx-note">{RECORD_CARD_DEADLINE_NOTE}</p>
            </section>
            <Docs view={view} role={role} directory={directory} refresh={!!review} />
            <Link href={c.fullHref} className="lx-btn lx-btn-sec lx-btn-sm">
              {RECORD_CARD_MENU_OPEN} →
            </Link>
          </div>
        </div>
      </Dialog>
    );
  }

  // Lead
  const members = directory;
  const yoursDue = view.top.kind === "yours" && view.steps.status === "ok" ? (view.steps.items.find((i) => i.id === (view.top as { taskId: string }).taskId)?.dueIso ?? null) : null;
  const stageId = load.kind === "lead" ? load.lead.current_stage_id : null;
  return (
    <Dialog closeHref={view.closeHref} title={c.name} titleId={view.titleId} size="lg" className="rc-card">
      <div className="rc-head">
        {c.sub && <p className="lx-note">{c.sub}</p>}
        <Chips view={view} />
        <div className="rc-ctl">
          <RenameForm kind="lead" id={c.id} names={view.names} canEdit={c.edits.rename} />
          <CardMenu card={c} stepHref={stepsHere} />
        </div>
        <section className="rc-sec" aria-label={RECORD_CARD_TAGS}>
          {view.tags.status === "ok" ? <TagsEditor leadId={c.id} tags={view.tags} /> : <LoadFailedLine refresh={false}>{view.tags.text}</LoadFailedLine>}
        </section>
      </div>
      <div className="rc-cols">
        <div className="rc-main">
          <TopCardFrame>
            <TopCard leadId={c.id} view={view.top} canWriteSteps={c.edits.stepAdd} members={members} yoursDueDate={yoursDue} />
          </TopCardFrame>
          <StepsChecklist kind="lead" id={c.id} steps={view.steps} {...(assignees ? { assignees } : {})} />
          {c.edits.notes && (
            <section className="rc-sec" aria-label={RECORD_CARD_NOTE_HEADING}>
              <ComposerTabs text={review ? review.note : <NoteComposer leadId={c.id} />} voice={<VoiceNoteRecorder target={{ kind: "lead", id: c.id }} action={addLeadVoiceNote} />} />
            </section>
          )}
          <section className="rc-sec">
            <h3 className="lx-label">{RECORD_CARD_TIMELINE}</h3>
            <TimelineBlock view={view} tz={tz} urls={urls} leadUndo={{ leadId: c.id, canMove: c.edits.stage, currentStageId: stageId }} />
          </section>
        </div>
        <div className="rc-side">
          {review?.aside}
          <section className="rc-sec" aria-label={RECORD_CARD_CONTACT}>
            <h3 className="lx-label">{RECORD_CARD_CONTACT}</h3>
            {view.contact.call || view.contact.email ? (
              <div className="rc-linkrow">
                {view.contact.call && (
                  <a className="lx-btn lx-btn-sec lx-btn-sm" href={view.contact.call}>
                    {RECORD_CARD_CALL}
                  </a>
                )}
                {view.contact.email && (
                  <a className="lx-btn lx-btn-sec lx-btn-sm" href={view.contact.email}>
                    {RECORD_CARD_EMAIL}
                  </a>
                )}
              </div>
            ) : (
              <p className="lx-note">{RECORD_CARD_NO_CONTACT}</p>
            )}
            <p className="lx-note">{RECORD_CARD_CONTACT_NOTE}</p>
          </section>
          {view.facts && <FourFacts facts={view.facts} />}
          {view.proposal !== null && (
            <section className="rc-sec" aria-label={RECORD_CARD_PROPOSAL}>
              <h3 className="lx-label">{RECORD_CARD_PROPOSAL}</h3>
              {view.proposal.status === "unavailable" ? (
                <LoadFailedLine refresh={false}>{view.proposal.text}</LoadFailedLine>
              ) : view.proposal.status === "none" ? (
                <p className="lx-note">{RECORD_CARD_NO_PROPOSAL}</p>
              ) : (
                <>
                  {view.proposal.lines.map((l) => (
                    <p key={l.label} className="rc-fee">
                      <span>{l.label}</span>
                      <span>{l.value}</span>
                    </p>
                  ))}
                  <Link className="lx-link" href={view.proposal.href}>
                    {RECORD_CARD_OPEN_PROPOSAL} →
                  </Link>
                </>
              )}
            </section>
          )}
          <Docs view={view} role={role} directory={directory} refresh={!!review} />
          <WhatLectualDid leadId={c.id} did={view.did} />
          <Link href={c.fullHref} className="lx-btn lx-btn-sec lx-btn-sm">
            {RECORD_CARD_MENU_OPEN} →
          </Link>
        </div>
      </div>
    </Dialog>
  );
}
