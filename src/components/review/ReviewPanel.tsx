import Link from "next/link";
import type { ReviewRow } from "@/lib/review/buckets";
import type { DetailLoad } from "@/lib/review/detail-load";
import { activityLines } from "@/lib/review/detail";
import { dueText, lastContactText, shortDate } from "@/lib/review/format";
import { deadlineIsSoon } from "@/lib/review/format";
import { SNOOZE_CHOICES, SNOOZE_LABEL } from "@/lib/review/snooze";
import { WAITING_LABEL } from "@/lib/review/waiting";
import { TASK_TITLE_MAX } from "@/lib/matters/task-edit";
import { stageDisplayName } from "@/lib/matters/list-view";
import type { CloseStage } from "@/lib/review/close-stage";
import type { OpenRef } from "@/lib/review/open";
import {
  assignRecordAction,
  completeNextStepAction,
  logWhatHappenedAction,
  moveStageAction,
  setNextStepAction,
  snoozeNextStepAction,
  updateNextStepAction,
} from "@/app/dashboard/review/actions";
import { EmptyState } from "@/components/ui/EmptyState";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { Pill } from "@/components/ui/Pill";
import { ADD_TO_TIMELINE, BLANK, LAST_CONTACT, OWNER_COLUMN, TEAMMATE, UNASSIGNED, noneYet, ADD_ANOTHER_NEXT_STEP, ADD_NEXT_STEP } from "@/lib/ui/words";
import { ActForm } from "./ActForm";
import { LostNurture } from "./LostNurture";
import { PanelShell } from "./PanelShell";
import { ReviewDocuments } from "./ReviewDocuments";
import "./review.css";

type Member = { userId: string; name: string };

export type PanelProps = {
  open: OpenRef;
  row: ReviewRow | null;
  detail: DetailLoad;
  today: string;
  timeZone: string;
  members: Member[];
  /** The role can write matters and leads (next steps, notes, assignment). */
  canWrite: boolean;
  /** FILE_UPLOAD_ROLES, decided by the page like the lead and matter pages do. */
  canUpload?: boolean;
  /** The role can also move a LEAD's stage. */
  canMove: boolean;
  closeStages: CloseStage[];
  closeHref: string;
};

const TITLE_ID = "rv-panel-title";

function MemberOptions({ members }: { members: Member[] }) {
  return (
    <>
      <option value="">{UNASSIGNED}</option>
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="lx-label">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function fullPage(open: OpenRef): string {
  return `/dashboard/${open.kind === "matter" ? "matters" : "leads"}/${open.id}/`;
}

/** One record's detail, read again through the scoped client by the page. Read-only roles see the same facts with no form. */
export function ReviewPanel(props: PanelProps) {
  const { open, row, detail, today, timeZone, members, canWrite, canMove, closeStages, closeHref, canUpload = false } = props;
  const names = new Map(members.map((m) => [m.userId, m.name]));
  const who = (id: string | null) => (id ? names.get(id) ?? TEAMMATE : null);

  if (detail.status !== "ok" || !row) {
    const text =
      detail.status === "missing"
        ? "This record couldn't be found."
        : detail.status === "unavailable"
          ? "This record couldn't be loaded. Refresh to try again."
          : "This record isn't on the weekly review right now.";
    return (
      <PanelShell closeHref={closeHref} titleId={TITLE_ID} title="Record">
        {detail.status === "unavailable" ? <LoadFailedLine refresh={false}>{text}</LoadFailedLine> : <p className="lx-note" role="status">{text}</p>}
        <div className="rv-panel-foot">
          {detail.status === "ok" && (
            <Link href={fullPage(open)} className="lx-btn lx-btn-sec lx-btn-sm">
              Open the full {open.kind === "matter" ? "matter" : "lead"} page →
            </Link>
          )}
          <Link href={closeHref} className="lx-btn lx-btn-ghost lx-btn-sm" scroll={false}>
            Close
          </Link>
        </div>
      </PanelShell>
    );
  }

  const next = row.nextStep;
  const due = next ? dueText(next.dueDate, today) : null;
  const stepNames = next ? who(next.assigneeId) : null;
  const otherSteps = detail.steps.ok ? detail.steps.items.filter((s) => s.id !== next?.id) : [];
  const stageWritable = open.kind === "matter" ? canWrite : canMove;
  const lines = detail.activity.ok ? activityLines(detail.activity.items, timeZone, today) : null;
  const hidden = (
    <>
      <input type="hidden" name="kind" value={open.kind} />
      <input type="hidden" name="id" value={open.id} />
    </>
  );

  return (
    <PanelShell closeHref={closeHref} titleId={TITLE_ID} title={row.client}>
      <p className="lx-note rv-panel-kind">
        {open.kind === "lead" ? "Lead" : "Matter"}
        {row.mark ? ` · ${row.mark}` : ""}
      </p>

      <dl className="rv-facts rv-panel-facts">
        <Fact label="Stage">
          {row.stageLabel ?? BLANK}
          <span className="lx-note rv-sub">{row.stageDays !== null ? `${row.stageDays}d in stage` : row.stageNote ?? ""}</span>
        </Fact>
        <Fact label={OWNER_COLUMN}>{who(detail.assignedTo) ?? UNASSIGNED}</Fact>
        <Fact label="Came from">{detail.cameFrom ?? BLANK}</Fact>
        <Fact label={LAST_CONTACT}>{lastContactText(row, today)}</Fact>
        <Fact label="Waiting on">{row.waiting ? WAITING_LABEL[row.waiting] : BLANK}</Fact>
        <Fact label="USPTO deadline">
          {row.deadline ? (
            <span className={deadlineIsSoon(row.deadline.dueDate, today) ? "rv-deadline-soon" : undefined}>
              {shortDate(row.deadline.dueDate, today)}
              {row.deadline.title ? <span className="lx-note rv-sub">{row.deadline.title}</span> : null}
            </span>
          ) : (
            BLANK
          )}
        </Fact>
        {row.proposalExpiry && (
          <Fact label="Proposal">
            <Pill tone={row.proposalExpiry.expired ? "risk" : "mute"}>{row.proposalExpiry.text}</Pill>
          </Fact>
        )}
      </dl>
      <p>
        <Link href={fullPage(open)} className="rv-panel-full lx-link">
          Open the full {open.kind === "matter" ? "matter" : "lead"} page →
        </Link>
      </p>

      <section className="rv-panel-sec" aria-labelledby="rv-sec-next">
        <h3 id="rv-sec-next" className="lx-label">
          Next step
        </h3>
        {next && due ? (
          canWrite ? (
            <>
              <ActForm key={`${next.id}|${next.title}|${next.dueDate}|${next.assigneeId}`} action={updateNextStepAction} submit="Save">
                <input type="hidden" name="taskId" value={next.id} />
                <input className="lx-input" name="title" maxLength={TASK_TITLE_MAX} defaultValue={next.title} aria-label="Next step" required />
                <input className="lx-input" type="date" name="dueAt" defaultValue={next.dueDate ?? ""} aria-label="Due date" />
                <select className="lx-input" name="assigneeId" defaultValue={next.assigneeId ?? ""} aria-label={OWNER_COLUMN}>
                  <MemberOptions members={members} />
                </select>
              </ActForm>
              <div className="rv-snooze" role="group" aria-label="Snooze">
                {SNOOZE_CHOICES.map((c) => (
                  <ActForm key={c} action={snoozeNextStepAction} submit={SNOOZE_LABEL[c]} className="rv-inline" buttonClass="lx-btn lx-btn-ghost lx-btn-sm">
                    <input type="hidden" name="taskId" value={next.id} />
                    <input type="hidden" name="when" value={c} />
                  </ActForm>
                ))}
                <ActForm action={completeNextStepAction} submit="Done" className="rv-inline" buttonClass="lx-btn lx-btn-pri lx-btn-sm">
                  <input type="hidden" name="taskId" value={next.id} />
                </ActForm>
              </div>
            </>
          ) : (
            <p className="rv-readonly">
              {next.title}
              <span className={`lx-note rv-sub${due.overdue ? " rv-deadline-soon" : ""}`}>
                {due.text}
                {stepNames ? ` · ${stepNames}` : ""}
              </span>
            </p>
          )
        ) : (
          <EmptyState variant="line">No next step.</EmptyState>
        )}
        {canWrite && (
          <details className="rv-more" open={!next}>
            <summary className="lx-btn lx-btn-sec lx-btn-sm">{next ? ADD_ANOTHER_NEXT_STEP : ADD_NEXT_STEP}</summary>
            <ActForm action={setNextStepAction} submit="Save next step">
              {hidden}
              <input className="lx-input" name="title" maxLength={TASK_TITLE_MAX} placeholder="What happens next" aria-label="New next step" required />
              <input className="lx-input" type="date" name="dueAt" aria-label="New step due date" />
              <select className="lx-input" name="assigneeId" defaultValue={next?.assigneeId ?? detail.assignedTo ?? ""} aria-label="New step assigned to">
                <MemberOptions members={members} />
              </select>
            </ActForm>
          </details>
        )}
      </section>

      {(otherSteps.length > 0 || !detail.steps.ok) && (
        <section className="rv-panel-sec" aria-labelledby="rv-sec-steps">
          <h3 id="rv-sec-steps" className="lx-label">
            Other open steps
          </h3>
          {!detail.steps.ok ? (
            <LoadFailedLine refresh={false}>Other steps couldn&apos;t load.</LoadFailedLine>
          ) : (
            <ul className="rv-steps">
              {otherSteps.map((s) => {
                const d = dueText(s.dueDate, today);
                return (
                  <li key={s.id}>
                    <span>
                      {s.title}
                      <span className={`lx-note rv-sub${d.overdue ? " rv-deadline-soon" : ""}`}>
                        {d.text}
                        {who(s.assigneeId) ? ` · ${who(s.assigneeId)}` : ""}
                      </span>
                    </span>
                    {canWrite && (
                      <ActForm action={completeNextStepAction} submit="Done" className="rv-inline" buttonClass="lx-btn lx-btn-ghost lx-btn-sm">
                        <input type="hidden" name="taskId" value={s.id} />
                      </ActForm>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className="rv-panel-sec" aria-labelledby="rv-sec-record">
        <h3 id="rv-sec-record" className="lx-label">
          Stage and owner
        </h3>
        {!detail.stages.ok ? (
          <LoadFailedLine refresh={false}>Stages couldn&apos;t load.</LoadFailedLine>
        ) : stageWritable ? (
          <ActForm key={`stage|${detail.currentStageId}`} action={moveStageAction} submit="Move stage">
            {hidden}
            <select className="lx-input" name="stageId" aria-label="Move stage" defaultValue={detail.stages.options.some((o) => o.id === detail.currentStageId) ? detail.currentStageId ?? "" : ""}>
              {!detail.stages.options.some((o) => o.id === detail.currentStageId) && (
                <option value="" disabled>
                  {row.stageLabel ?? "Choose a stage"}
                </option>
              )}
              {detail.stages.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {stageDisplayName(o.name)}
                </option>
              ))}
            </select>
          </ActForm>
        ) : null}
        {canWrite && (
          <ActForm key={`owner|${detail.assignedTo}`} action={assignRecordAction} submit="Assign">
            <input type="hidden" name="kind" value={open.kind} />
            <input type="hidden" name="id" value={open.id} />
            <select className="lx-input" name="userId" defaultValue={detail.assignedTo ?? ""} aria-label={OWNER_COLUMN}>
              <MemberOptions members={members} />
            </select>
          </ActForm>
        )}
        {open.kind === "lead" && canMove && closeStages.length > 0 && <LostNurture id={open.id} stages={closeStages} />}
      </section>

      <ReviewDocuments open={open} documents={detail.documents} members={members} today={today} timeZone={timeZone} canWrite={canWrite} canUpload={canUpload} />

      {canWrite && (
        <section className="rv-panel-sec" id="rv-sec-note" aria-labelledby="rv-sec-note-h">
          <h3 id="rv-sec-note-h" className="lx-label">
            Log what happened
          </h3>
          <ActForm action={logWhatHappenedAction} submit={ADD_TO_TIMELINE}>
            {hidden}
            <textarea className="lx-input" name="body" rows={3} placeholder="A short note for the timeline" aria-label="What happened" required />
          </ActForm>
        </section>
      )}

      <section className="rv-panel-sec" aria-labelledby="rv-sec-act">
        <h3 id="rv-sec-act" className="lx-label">
          Recent activity
        </h3>
        {lines === null ? (
          <LoadFailedLine refresh={false}>Recent activity couldn&apos;t load.</LoadFailedLine>
        ) : lines.length === 0 ? (
          <EmptyState variant="line">{noneYet("activity")}</EmptyState>
        ) : (
          <ol className="rv-activity">
            {lines.map((l) => (
              <li key={l.id}>
                <span>{l.title}</span> <span className="lx-note">{l.when}</span>
                {l.note && <p className="rv-activity-note">{l.note}</p>}
              </li>
            ))}
          </ol>
        )}
      </section>
    </PanelShell>
  );
}
