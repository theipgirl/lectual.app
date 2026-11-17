import Link from "next/link";
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
import { buildOpenedCard, type OpenedCardView, type RecordCardLoad } from "@/lib/record-card/model";
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
import { CardMenu, NextStepLine, OwnerPick, SourcePick, StagePick, TempPill } from "./controls";
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

async function TimelineBlock({ view, tz, leadUndo }: { view: Ok; tz: string; leadUndo?: { leadId: string; canMove: boolean; currentStageId: string | null } }) {
  if (view.timeline.status !== "ok") return <LoadFailedLine refresh={false}>{LEAD_STEP_COULDNT_LOAD}</LoadFailedLine>;
  // The same rows the lead and matter pages hand the timeline (crm_activity), read by the card's loader.
  const rows = view.timeline.value.rows as unknown as Parameters<typeof Timeline>[0]["rows"];
  const urls = await voiceNotePlaybackUrls(rows as unknown as Parameters<typeof voiceNotePlaybackUrls>[0]).catch(() => ({}));
  return <Timeline rows={rows} mediaUrls={urls} timeZone={tz} undo={leadUndo} />;
}

function Docs({ view, role, directory }: { view: Ok; role: string; directory: { userId: string; name: string }[] }) {
  if (view.documents.status !== "ok") return <LoadFailedLine refresh={false}>{LEAD_STEP_COULDNT_LOAD}</LoadFailedLine>;
  return (
    <DocumentsCard
      parent={{ kind: view.kind, id: view.card.id }}
      read={view.documents.value}
      directory={directory}
      canUpload={view.card.edits.upload}
      canDelete={(FILE_DELETE_ROLES as readonly string[]).includes(role)}
    />
  );
}

/**
 * The opened card (`?open=`): the kit's Dialog, centred from 900px and a full-screen sheet below. It is SERVER rendered from
 * the param: the record is re-read through the scoped client (`loadRecordCard`), a foreign or missing id says "couldn't be
 * found" with no field of the record, a failed read says so. Esc, Back and the close button all follow the close LINK.
 * Nothing here sends: Call and Email open the person's own apps.
 */
export async function RecordCardHost({ open, path, params, duplicateOf, load: given }: { open: CardRef | null; path: string; params: CurrentParams; duplicateOf?: string | null; load?: RecordCardLoad }) {
  if (!open) return null;
  const load = given ?? (await loadRecordCard(open, { duplicateOf }));
  const view = buildOpenedCard(load, { path, params });
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
  const stepsHere = openHref(path, params, { kind: view.kind, id: c.id }) + "#card-steps";

  if (view.kind === "matter") {
    const matter = load.kind === "matter" ? load.matter : null;
    const first = view.steps.status === "ok" ? view.steps.items[0] : null;
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
            <section className="rc-sec" aria-label="Next step">
              <NextStepLine kind="matter" id={c.id} line={c.nextStep} dueIso={first?.dueIso ?? null} text={c.bottom.nextStep} />
            </section>
            <StepsChecklist kind="matter" id={c.id} steps={view.steps} />
            {c.edits.notes && (
              <section className="rc-sec" aria-label={RECORD_CARD_NOTE_HEADING}>
                <div className="lx-composer">
                  <MatterNoteComposer matterId={c.id} />
                  <VoiceNoteRecorder target={{ kind: "matter", id: c.id }} action={addMatterVoiceNote} />
                </div>
              </section>
            )}
            <section className="rc-sec">
              <h3 className="lx-label">{RECORD_CARD_TIMELINE}</h3>
              <TimelineBlock view={view} tz={tz} />
            </section>
          </div>
          <div className="rc-side">
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
            <Docs view={view} role={role} directory={directory} />
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
          <StepsChecklist kind="lead" id={c.id} steps={view.steps} />
          {c.edits.notes && (
            <section className="rc-sec" aria-label={RECORD_CARD_NOTE_HEADING}>
              <ComposerTabs text={<NoteComposer leadId={c.id} />} voice={<VoiceNoteRecorder target={{ kind: "lead", id: c.id }} action={addLeadVoiceNote} />} />
            </section>
          )}
          <section className="rc-sec">
            <h3 className="lx-label">{RECORD_CARD_TIMELINE}</h3>
            <TimelineBlock view={view} tz={tz} leadUndo={{ leadId: c.id, canMove: c.edits.stage, currentStageId: stageId }} />
          </section>
        </div>
        <div className="rc-side">
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
          <section className="rc-sec" aria-label={RECORD_CARD_PROPOSAL}>
            <h3 className="lx-label">{RECORD_CARD_PROPOSAL}</h3>
            {view.proposal === null ? null : view.proposal.status === "unavailable" ? (
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
          <Docs view={view} role={role} directory={directory} />
          <WhatLectualDid leadId={c.id} did={view.did} />
          <Link href={c.fullHref} className="lx-btn lx-btn-sec lx-btn-sm">
            {RECORD_CARD_MENU_OPEN} →
          </Link>
        </div>
      </div>
    </Dialog>
  );
}
