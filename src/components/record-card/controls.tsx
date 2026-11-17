"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Popover, { PopoverItem } from "@/components/list-page/Popover";
import { Toast } from "@/components/ui/Toast";
import { setLaneAction, setSourceAction } from "@/app/dashboard/intake/actions";
import { logConsultOutcomeAction } from "@/app/dashboard/leads/[id]/outcome-actions";
import { updateMatterHeaderAction } from "@/app/dashboard/matters/[id]/actions";
import { assignRecordAction, completeNextStepAction, moveStageAction, setNextStepAction, snoozeNextStepAction, updateNextStepAction } from "@/app/dashboard/review/actions";
import { SNOOZE_CHOICES, SNOOZE_LABEL } from "@/lib/review/snooze";
import { TASK_TITLE_MAX } from "@/lib/matters/task-edit";
import { startHold, type Hold } from "@/lib/record-card/hold";
import type { CardMember, CardView, StepLine } from "@/lib/record-card/model";
import type { TemperatureControl, MenuItem, CardKind } from "@/lib/record-card/rules";
import type { ReferralSource } from "@/lib/intake";
import {
  RECORD_CARD_ADD_STEP,
  RECORD_CARD_NO_SHOW_DONE,
  RECORD_CARD_NO_SHOW_NOTE,
  RECORD_CARD_NO_SHOW_UNDO,
  RECORD_CARD_NO_SHOW_UNDONE,
  RECORD_CARD_NO_SOURCE,
  RECORD_CARD_SAVING,
  RECORD_CARD_SET_BTN,
  RECORD_CARD_STEP_DONE,
  RECORD_CARD_STEP_DUE,
  RECORD_CARD_STEP_SAVE,
  RECORD_CARD_STEP_TITLE,
  RECORD_CARD_STAGE,
  RECORD_CARD_MOVE_PLACEHOLDER,
  RECORD_CARD_MENU_LABEL,
  recordCardControlLabel,
  recordCardNoShowHeld,
  OWNER_COLUMN,
  UNASSIGNED,
} from "@/lib/ui/words";
import { Icon } from "@/components/ui/Icon";
import { SavedMarkView } from "./SavedMarkView";
import { useRun, viaForm } from "./use-run";
import "./record-card.css";

const initials = (name: string) => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "")).toUpperCase() || "?";
};

// ---------------------------------------------------------------------------------------------------------------------
// Temperature (leads). The pill is FILLED for a person's level and OUTLINED with a "suggested" mark for Lectual's.

type Lane3 = "hot" | "warm" | "cold";

/**
 * The pill and its menu, with no hooks of its own (the Intake cell calls it for its element tree, as its tests do).
 * `onPick` is the caller's write; a role that can't set it has an empty menu and gets plain text.
 */
export function TempMenu({ name, control, pending, onPick }: { name: string; control: TemperatureControl; pending: boolean; onPick: (lane: Lane3 | null) => void }) {
  const { pill, menu } = control;
  const shown = (
    <>
      {pill.value ? pill.label : menu.length ? RECORD_CARD_SET_BTN : pill.label}
      {pill.mark && <span className="rc-temp-mark">{pill.mark}</span>}
    </>
  );
  if (menu.length === 0) {
    return pill.value ? (
      <span className="rc-temp" data-tone={pill.value} data-style={pill.style} title={pill.title}>
        {shown}
      </span>
    ) : null;
  }
  return (
    <Popover
      label={`${recordCardControlLabel("Temperature", name)}: ${pill.label}${pill.mark ? ` (${pill.mark})` : ""}`}
      width={230}
      trigger={({ onClick, ref, ...aria }) => (
        <button {...aria} ref={ref} type="button" disabled={pending} onClick={onClick} className="rc-temp" data-testid="temperature-cell" data-tone={pill.value ?? undefined} data-style={pill.style} data-empty={pill.value ? undefined : ""} title={pill.title}>
          {shown}
        </button>
      )}
    >
      {(close) =>
        menu.map((choice, i) => (
          <PopoverItem
            key={`${choice.kind}-${choice.value ?? "none"}-${i}`}
            checked={choice.current}
            muted={choice.value === null}
            onSelect={() => {
              close();
              onPick(choice.value);
            }}
          >
            {choice.label}
          </PopoverItem>
        ))
      }
    </Popover>
  );
}

/** Temperature on the opened card: Accept and the levels call `setLaneAction`, and "Saved" is the action's own answer. */
export function TempPill({ leadId, name, control }: { leadId: string; name: string; control: TemperatureControl }) {
  const { pending, mark, run } = useRun();
  return (
    <span className="rc-ctl">
      <TempMenu name={name} control={control} pending={pending} onPick={(lane) => run(() => setLaneAction(leadId, lane))} />
      <SavedMarkView mark={mark} />
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Source: the firm's list only.

export function SourcePick({ kind, id, name, value, choices, compact, onPick }: { kind: CardKind; id: string; name: string; value: string | null; choices: readonly string[] | null; compact?: boolean; onPick?: (s: ReferralSource | null) => void }) {
  const { pending, mark, run } = useRun();
  const text = value ?? (compact ? RECORD_CARD_NO_SOURCE : "—");
  if (!choices) return <span className="rc-text" data-empty={value ? undefined : ""}>{text}</span>;
  return (
    <span className="rc-ctl">
      <Popover
        label={`${recordCardControlLabel("Source", name)}: ${value ?? "none"}. Change source`}
        width={180}
        trigger={({ onClick, ref, ...aria }) => (
          <button {...aria} ref={ref} type="button" disabled={pending} onClick={onClick} className="rc-btn" data-empty={value ? undefined : ""}>
            {text}
          </button>
        )}
      >
        {(close) => (
          <>
            {kind === "lead" && (
              <PopoverItem
                muted
                checked={value == null}
                onSelect={() => {
                  close();
                  if (value == null) return;
                  if (onPick) onPick(null);
                  else run(() => setSourceAction(id, null));
                }}
              >
                None
              </PopoverItem>
            )}
            {choices.map((option) => (
              <PopoverItem
                key={option}
                checked={value === option}
                onSelect={() => {
                  close();
                  if (value === option) return;
                  if (onPick) onPick(option as ReferralSource);
                  else if (kind === "lead") run(() => setSourceAction(id, option as ReferralSource));
                  else run(viaForm(updateMatterHeaderAction, { matterId: id, referralSource: option }));
                }}
              >
                {option}
              </PopoverItem>
            ))}
          </>
        )}
      </Popover>
      {!onPick && <SavedMarkView mark={mark} />}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Owner: an avatar menu.

export function OwnerPick({ kind, id, name, owner, onPick, withName }: { kind: CardKind; id: string; name: string; owner: CardView["owner"]; onPick?: (userId: string | null) => void; withName?: boolean }) {
  const { pending, mark, run } = useRun();
  const unassigned = owner.id === null;
  const face = unassigned ? "—" : initials(owner.name);
  const label = (
    <>
      <span className="rc-avatar" data-empty={unassigned ? "" : undefined} aria-hidden>
        {face}
      </span>
      {withName && <span className="rc-owner-name">{owner.name}</span>}
    </>
  );
  if (!owner.choices)
    return (
      <span className="rc-text" title={owner.name}>
        {label}
      </span>
    );
  const members: CardMember[] = owner.choices;
  return (
    <span className="rc-ctl">
      <Popover
        label={`${recordCardControlLabel(OWNER_COLUMN, name)}: ${owner.name}. Reassign`}
        width={210}
        trigger={({ onClick, ref, ...aria }) => (
          <button {...aria} ref={ref} type="button" disabled={pending} onClick={onClick} className="rc-btn rc-owner" title={owner.name}>
            {label}
          </button>
        )}
      >
        {(close) => (
          <>
            <PopoverItem
              muted
              checked={unassigned}
              onSelect={() => {
                close();
                if (unassigned) return;
                if (onPick) onPick(null);
                else run(viaForm(assignRecordAction, { kind, id, userId: "" }));
              }}
            >
              {UNASSIGNED}
            </PopoverItem>
            {members.map((m) => (
              <PopoverItem
                key={m.userId}
                checked={owner.id === m.userId}
                onSelect={() => {
                  close();
                  if (owner.id === m.userId) return;
                  if (onPick) onPick(m.userId);
                  else run(viaForm(assignRecordAction, { kind, id, userId: m.userId }));
                }}
              >
                {m.name}
              </PopoverItem>
            ))}
          </>
        )}
      </Popover>
      {!onPick && <SavedMarkView mark={mark} />}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Stage: a pill that opens the targets (never `won` for a lead: `moveTargets`).

export function StagePick({ kind, id, name, stage, onPick }: { kind: CardKind; id: string; name: string; stage: CardView["stage"]; onPick?: (stageId: string) => void }) {
  const { pending, mark, run } = useRun();
  const text = stage.name ?? "—";
  if (stage.targets.length === 0) return <span className="rc-pill" title={text}>{text}</span>;
  return (
    <span className="rc-ctl">
      <Popover
        label={`${recordCardControlLabel(RECORD_CARD_STAGE, name)}: ${text}. ${RECORD_CARD_MOVE_PLACEHOLDER}`}
        width={230}
        trigger={({ onClick, ref, ...aria }) => (
          <button {...aria} ref={ref} type="button" disabled={pending} onClick={onClick} className="rc-pill rc-pill-btn" title={text}>
            {text}
          </button>
        )}
      >
        {(close) => (
          <div className="rc-menu-scroll">
            {stage.targets.map((t) => (
              <PopoverItem
                key={t.id}
                onSelect={() => {
                  close();
                  if (onPick) onPick(t.id);
                  else run(viaForm(moveStageAction, { kind, id, stageId: t.id }));
                }}
              >
                {t.name}
              </PopoverItem>
            ))}
          </div>
        )}
      </Popover>
      {!onPick && <SavedMarkView mark={mark} />}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Next step: title and date in place, snooze, done; "Add a next step" when there is none.

type Step = { id: string; title: string; due: string; overdue: boolean };

/** Inline form for one step (edit) or a new one (add). Uses the review's existing actions; the role gate is theirs. */
export function StepForm({ kind, id, step, dueIso, onDone, autoFocus }: { kind: CardKind; id: string; step: Step | null; dueIso?: string | null; onDone: () => void; autoFocus?: boolean }) {
  const { pending, mark, run } = useRun(onDone);
  const [title, setTitle] = useState(step?.title ?? "");
  const [due, setDue] = useState(dueIso ?? "");
  return (
    <form
      className="rc-stepform"
      onSubmit={(e) => {
        e.preventDefault();
        if (step) run(viaForm(updateNextStepAction, { taskId: step.id, title, dueAt: due }));
        else run(viaForm(setNextStepAction, { kind, id, title, dueAt: due, assigneeId: "" }));
      }}
    >
      <input className="lx-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TASK_TITLE_MAX} aria-label={RECORD_CARD_STEP_TITLE} placeholder="What happens next" required autoFocus={autoFocus} />
      <input className="lx-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={RECORD_CARD_STEP_DUE} />
      <button type="submit" className="lx-btn lx-btn-sec lx-btn-sm" disabled={pending}>
        {pending ? RECORD_CARD_SAVING : step ? RECORD_CARD_STEP_SAVE : RECORD_CARD_ADD_STEP}
      </button>
      <SavedMarkView mark={mark} />
    </form>
  );
}

export function SnoozeDone({ taskId, snooze, done }: { taskId: string; snooze: boolean; done: boolean }) {
  const { pending, mark, run } = useRun();
  return (
    <span className="rc-snooze" role="group" aria-label="Snooze or finish">
      {snooze &&
        SNOOZE_CHOICES.map((c) => (
          <button key={c} type="button" className="lx-btn lx-btn-ghost lx-btn-sm" disabled={pending} onClick={() => run(viaForm(snoozeNextStepAction, { taskId, when: c }))}>
            {SNOOZE_LABEL[c]}
          </button>
        ))}
      {done && (
        <button type="button" className="lx-btn lx-btn-pri lx-btn-sm" disabled={pending} onClick={() => run(viaForm(completeNextStepAction, { taskId }))}>
          {RECORD_CARD_STEP_DONE}
        </button>
      )}
      <SavedMarkView mark={mark} />
    </span>
  );
}

/** The next-step line of a card or row. Read-only roles get the text and nothing else. */
export function NextStepLine({ kind, id, line, dueIso, text }: { kind: CardKind; id: string; line: StepLine; dueIso?: string | null; text: string }) {
  const [open, setOpen] = useState(false);
  if (line.status !== "ok") return <span className="rc-text rc-warn">{line.text}</span>;
  if (open && (line.step ? line.edit : line.add)) return <StepForm kind={kind} id={id} step={line.step} dueIso={dueIso} onDone={() => setOpen(false)} autoFocus />;
  if (!line.step)
    return line.add ? (
      <button type="button" className="rc-btn" onClick={() => setOpen(true)}>
        {line.add}
      </button>
    ) : (
      <span className="rc-text" data-empty="">{text}</span>
    );
  return (
    <span className="rc-stepline" data-overdue={line.step.overdue ? "" : undefined}>
      {line.edit ? (
        <button type="button" className="rc-btn rc-step-text" onClick={() => setOpen(true)} title={text}>
          {text}
        </button>
      ) : (
        <span className="rc-text rc-step-text" title={text}>{text}</span>
      )}
      {(line.snooze || line.done) && <SnoozeDone taskId={line.step.id} snooze={line.snooze} done={line.done} />}
    </span>
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// The ⋯ menu's shared items, and the no-show hold.

/** Mark no-show: NOTHING is posted for 5 seconds; Undo inside the hold posts nothing; then ONE `call_logged` row. */
export function useNoShow(leadId: string, name: string) {
  const { mark, run } = useRun();
  const [held, setHeld] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const holdRef = useRef<Hold | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => void holdRef.current?.cancel(), []);
  const begin = () => {
    setMessage(null);
    setHeld(true);
    holdRef.current = startHold(() => {
      setHeld(false);
      run(viaForm(logConsultOutcomeAction, { leadId, outcome: "no_show", note: noteRef.current?.value ?? "" }));
      setMessage(RECORD_CARD_NO_SHOW_DONE);
    });
  };
  const undo = () => {
    holdRef.current?.cancel();
    setHeld(false);
    setMessage(RECORD_CARD_NO_SHOW_UNDONE);
  };
  const toast = held ? (
    <Toast
      action={
        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={undo}>
          {RECORD_CARD_NO_SHOW_UNDO}
        </button>
      }
    >
      <span>{recordCardNoShowHeld(name)}</span>{" "}
      <input ref={noteRef} className="lx-input rc-noshow-note" aria-label={RECORD_CARD_NO_SHOW_NOTE} placeholder={RECORD_CARD_NO_SHOW_NOTE} maxLength={500} />
    </Toast>
  ) : null;
  return { begin, toast, mark, message };
}

/** The ⋯ menu for a board card, list row or opened card. Move to stage, Set next step, Mark no-show, Merge, Open full page. */
export function CardMenu({ card, onMovePick, stepHref }: { card: CardView; onMovePick?: (stageId: string) => void; stepHref: string }) {
  const { pending, mark, run } = useRun();
  const noShow = useNoShow(card.id, card.name);
  return (
    <span className="rc-ctl rc-menuwrap">
      <Popover
        label={RECORD_CARD_MENU_LABEL(card.name)}
        align="right"
        width={230}
        trigger={({ onClick, ref, ...aria }) => (
          <button {...aria} ref={ref} type="button" onClick={onClick} className="lx-board-menu" disabled={pending}>
            <Icon name="more" />
          </button>
        )}
      >
        {(close) => (
          <div className="rc-menu-scroll">
            {card.menu.map((item: MenuItem) => {
              if (item.id === "move")
                return (
                  <div key="move">
                    <span className="rc-menu-h lx-label">{item.label}</span>
                    {card.stage.targets.map((t) => (
                      <PopoverItem
                        key={t.id}
                        onSelect={() => {
                          close();
                          if (onMovePick) onMovePick(t.id);
                          else run(viaForm(moveStageAction, { kind: card.kind, id: card.id, stageId: t.id }));
                        }}
                      >
                        {t.name}
                      </PopoverItem>
                    ))}
                  </div>
                );
              if (item.id === "noShow")
                return (
                  <button key="noShow" type="button" className="lp-pop-item" onClick={() => { close(); noShow.begin(); }}>
                    <span className="lp-pop-text">{item.label}</span>
                  </button>
                );
              const href = item.id === "step" ? stepHref : (item.href ?? card.fullHref);
              return (
                <Link key={item.id} href={href} className="lp-pop-item" onClick={close} scroll={item.id !== "step" ? true : false}>
                  <span className="lp-pop-text">{item.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </Popover>
      <SavedMarkView mark={mark ?? noShow.mark} />
      {noShow.message && !noShow.mark && <span className="lx-saved" role="status">{noShow.message}</span>}
      {noShow.toast}
    </span>
  );
}
