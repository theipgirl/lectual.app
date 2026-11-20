"use client";

import { useState } from "react";
import { cardTagAction, renameLeadAction } from "@/lib/record-card/actions";
import { updateMatterHeaderAction } from "@/app/dashboard/matters/[id]/actions";
import type { ChecklistView, OpenedCardView } from "@/lib/record-card/model";
import {
  RECORD_CARD_ADD_TAG,
  RECORD_CARD_BUSINESS,
  RECORD_CARD_NO_STEPS,
  RECORD_CARD_NO_TAGS,
  RECORD_CARD_REMOVE_TAG,
  RECORD_CARD_SAVING,
  RECORD_CARD_STEP_SAVE,
  RECORD_CARD_TITLE,
  RECORD_CARD_STEPS_HEADING,
  RECORD_CARD_ADD_STEP,
  RECORD_CARD_A_TEAMMATE,
} from "@/lib/ui/words";
import { SnoozeDone, StepForm, type StepAssignees } from "./controls";
import { SavedMarkView } from "./SavedMarkView";
import { useRun, viaForm } from "./use-run";
import "./record-card.css";

/** The header's name and business (lead) or title (matter): read as text, edited in a small form. Posts ONLY the name fields. */
export function RenameForm({ kind, id, names, title, canEdit }: { kind: "lead" | "matter"; id: string; names?: { first: string; last: string; business: string }; title?: string; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const { pending, mark, run } = useRun(() => setOpen(false));
  const [first, setFirst] = useState(names?.first ?? "");
  const [last, setLast] = useState(names?.last ?? "");
  const [business, setBusiness] = useState(names?.business ?? "");
  const [name, setName] = useState(title ?? "");
  if (!canEdit) return null;
  if (!open)
    return (
      <span className="rc-ctl">
        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setOpen(true)}>
          {kind === "lead" ? "Edit name" : "Edit title"}
        </button>
        <SavedMarkView mark={mark} />
      </span>
    );
  return (
    <form
      className="rc-edit"
      onSubmit={(e) => {
        e.preventDefault();
        if (kind === "lead") run(viaForm(renameLeadAction, { leadId: id, firstName: first, lastName: last, businessName: business }));
        else run(viaForm(updateMatterHeaderAction, { matterId: id, title: name }));
      }}
    >
      {kind === "lead" ? (
        <>
          <input className="lx-input" value={first} onChange={(e) => setFirst(e.target.value)} aria-label="First name" placeholder="First name" maxLength={80} />
          <input className="lx-input" value={last} onChange={(e) => setLast(e.target.value)} aria-label="Last name" placeholder="Last name" maxLength={80} />
          <input className="lx-input" value={business} onChange={(e) => setBusiness(e.target.value)} aria-label={RECORD_CARD_BUSINESS} placeholder={RECORD_CARD_BUSINESS} maxLength={120} />
        </>
      ) : (
        <input className="lx-input" value={name} onChange={(e) => setName(e.target.value)} aria-label={RECORD_CARD_TITLE} maxLength={200} />
      )}
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        {pending ? RECORD_CARD_SAVING : RECORD_CARD_STEP_SAVE}
      </button>
      <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <SavedMarkView mark={mark} />
    </form>
  );
}

type Tags = Extract<OpenedCardView, { kind: "lead" }>["tags"];

/** Tags on a lead: add from the firm's tags, remove. Each answer shows "Saved" from `cardTagAction`'s own result. */
export function TagsEditor({ leadId, tags }: { leadId: string; tags: Extract<Tags, { status: "ok" }> }) {
  const { pending, mark, run } = useRun();
  return (
    <div className="rc-tags">
      {tags.on.length === 0 && <span className="rc-text" data-empty="">{RECORD_CARD_NO_TAGS}</span>}
      {tags.on.map((t) => (
        <span key={t.id} className="rc-tag">
          {t.label}
          {tags.edit && (
            <button type="button" aria-label={RECORD_CARD_REMOVE_TAG(t.label)} disabled={pending} onClick={() => run(viaForm(cardTagAction, { leadId, tagId: t.id, op: "remove" }))}>
              ×
            </button>
          )}
        </span>
      ))}
      {tags.edit && tags.addable.length > 0 && (
        <select className="lx-input" defaultValue="" aria-label={RECORD_CARD_ADD_TAG} disabled={pending} onChange={(e) => { const v = e.currentTarget.value; e.currentTarget.value = ""; if (v) run(viaForm(cardTagAction, { leadId, tagId: v, op: "add" })); }}>
          <option value="" disabled>
            {RECORD_CARD_ADD_TAG}…
          </option>
          {tags.addable.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      )}
      <SavedMarkView mark={mark} />
    </div>
  );
}

/**
 * The Next steps checklist: tick (Done), edit title and date, snooze, add. Draws only what the role may do. `assignees` (the
 * Weekly review only) adds who each step is assigned to: the team, each step's current assignee by task id, and the starting
 * choice for a new step. Without it the checklist is exactly as before.
 */
export function StepsChecklist({
  kind,
  id,
  steps,
  assignees,
}: {
  kind: "lead" | "matter";
  id: string;
  steps: ChecklistView;
  assignees?: { members: StepAssignees["members"]; byTask: Readonly<Record<string, string | null>>; forNew: string | null } | null;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  return (
    <section className="rc-sec" id="card-steps" aria-labelledby="rc-steps-h">
      <h3 id="rc-steps-h" className="lx-label">
        {RECORD_CARD_STEPS_HEADING}
      </h3>
      {steps.status !== "ok" ? (
        <p className="rc-err" role="status">{steps.text}</p>
      ) : (
        <>
          {steps.items.length === 0 && <p className="lx-note">{RECORD_CARD_NO_STEPS}</p>}
          <ul className="rc-checklist">
            {steps.items.map((s) => (
              <li key={s.id}>
                {editing === s.id && steps.edit ? (
                  <StepForm kind={kind} id={id} step={s} dueIso={s.dueIso} onDone={() => setEditing(null)} autoFocus assignees={assignees ? { members: assignees.members, current: assignees.byTask[s.id] ?? null } : null} />
                ) : (
                  <div className="rc-step-row" data-overdue={s.overdue ? "" : undefined}>
                    {steps.edit ? (
                      <button type="button" className="rc-btn" onClick={() => setEditing(s.id)}>
                        {s.title}
                      </button>
                    ) : (
                      <span className="rc-text">{s.title}</span>
                    )}
                    <span className="rc-text rc-step-due">{s.due}</span>
                    {assignees && assignees.byTask[s.id] && (
                      <span className="rc-text rc-step-who">{assignees.members.find((m) => m.userId === assignees.byTask[s.id])?.name ?? RECORD_CARD_A_TEAMMATE}</span>
                    )}
                  </div>
                )}
                {(steps.snooze || steps.done) && <SnoozeDone taskId={s.id} snooze={steps.snooze} done={steps.done} />}
              </li>
            ))}
          </ul>
          {steps.add &&
            (adding ? (
              <StepForm kind={kind} id={id} step={null} onDone={() => setAdding(false)} autoFocus assignees={assignees ? { members: assignees.members, current: assignees.forNew } : null} />
            ) : (
              <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => setAdding(true)}>
                {RECORD_CARD_ADD_STEP}
              </button>
            ))}
        </>
      )}
    </section>
  );
}

