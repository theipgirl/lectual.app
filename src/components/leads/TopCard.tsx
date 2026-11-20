import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { Pill } from "@/components/ui/Pill";
import { MEANING_TONE } from "@/lib/ui/tones";
import type { TopCardView } from "@/lib/lead-step/view-model";
import { LEAD_STEP_OVERDUE } from "@/lib/ui/words";
import { NeedsYourYes } from "./NeedsYourYes";
import { SetNextStep, YoursActions, type StepMember } from "./StepControls";
import "./lead-step.css";

/**
 * The ONE top card of the lead page, drawn from the engine's view-model (`buildLeadStepView`). It decides nothing: which
 * card, which buttons and every word came from the view. `canWriteSteps` only decides whether the existing next-step forms
 * are drawn (the roles that may write leads); the actions re-check the role themselves.
 */
export function TopCard({
  leadId,
  view,
  canWriteSteps,
  members,
  yoursDueDate = null,
}: {
  leadId: string;
  view: TopCardView;
  canWriteSteps: boolean;
  members: StepMember[];
  /** The open step's due date as YYYY-MM-DD (for the Change form), or null. */
  yoursDueDate?: string | null;
}) {
  switch (view.kind) {
    case "needs-yes":
      return <NeedsYourYes key={view.itemId} leadId={leadId} view={view} />;
    case "has-it":
      return (
        <section className="lx-card ls-card" aria-label="Next step" data-step="has-it">
          <div className="ls-eyebrow">
            <Pill tone={MEANING_TONE.done}>{view.eyebrow}</Pill>
          </div>
          <h2 className="ls-h">{view.waitingFor}</h2>
          <p className="ls-why-text">{view.line}</p>
        </section>
      );
    case "yours":
      return (
        <section className="lx-card ls-card" aria-label="Next step" data-step="yours">
          <div className="ls-eyebrow">
            <Pill tone={MEANING_TONE.needsPerson}>{view.eyebrow}</Pill>
            {view.overdue && <Pill tone={MEANING_TONE.overdue}>{LEAD_STEP_OVERDUE}</Pill>}
          </div>
          <h2 className="ls-h">{view.title}</h2>
          {(view.dueText || view.others) && (
            <p className="ls-meta">
              {view.dueText && <span className={view.overdue ? "ls-over" : undefined}>{view.dueText}</span>}
              {view.others && <span>{view.others}</span>}
            </p>
          )}
          {view.note && <LoadFailedLine refresh={false}>{view.note}</LoadFailedLine>}
          {canWriteSteps && <YoursActions taskId={view.taskId} title={view.title} dueDate={yoursDueDate} assigneeId={view.assigneeId} members={members} />}
        </section>
      );
    case "not-prepared":
      return (
        <section className="lx-card ls-card" aria-label="Next step" data-step="not-prepared">
          <div className="ls-eyebrow">
            <Pill tone={MEANING_TONE.needsPerson}>{view.eyebrow}</Pill>
          </div>
          {view.title && <h2 className="ls-h">{view.title}</h2>}
          <p className="ls-why-text">{view.text}</p>
          {view.off && <p className="ls-why-text">{view.off}</p>}
          {canWriteSteps && <SetNextStep leadId={leadId} members={members} />}
        </section>
      );
    case "approvals-off":
      return (
        <section className="lx-card ls-card" aria-label="Next step" data-step="approvals-off">
          <div className="ls-eyebrow">
            <Pill>{view.eyebrow}</Pill>
          </div>
          <p className="ls-why-text">{view.text}</p>
          {canWriteSteps && <SetNextStep leadId={leadId} members={members} />}
        </section>
      );
    case "quiet":
      return (
        <section className="lx-card ls-card" aria-label="Next step" data-step="quiet">
          <div className="ls-eyebrow">
            <Pill>{view.eyebrow}</Pill>
          </div>
          <p className="ls-why-text">{view.text}</p>
          {canWriteSteps && <SetNextStep leadId={leadId} members={members} />}
        </section>
      );
    case "couldnt-load":
      return (
        <section className="lx-card ls-card" aria-label="Next step" data-step="couldnt-load">
          <LoadFailedLine refresh={false}>{view.text}</LoadFailedLine>
        </section>
      );
  }
}
