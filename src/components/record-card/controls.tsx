"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Popover, { PopoverItem } from "@/components/list-page/Popover";
import { Toast } from "@/components/ui/Toast";
import { setLaneAction, setSourceAction } from "@/app/dashboard/intake/actions";
import { logConsultOutcomeAction } from "@/app/dashboard/leads/[id]/outcome-actions";
import {
  assignRecordAction,
  completeNextStepAction,
  moveStageAction,
  setNextStepAction,
  setSourceAction as setRecordSourceAction,
  snoozeNextStepAction,
  updateNextStepAction,
} from "@/app/dashboard/review/actions";
import { SNOOZE_CHOICES, SNOOZE_LABEL } from "@/lib/review/snooze";
import { TASK_TITLE_MAX } from "@/lib/matters/task-edit";
import { beginOnce, noShowOffered, type Hold } from "@/lib/record-card/hold";
import { noShowNotices } from "@/components/record-card/no-show-notices";
import type { CardMember, CardView, StepLine } from "@/lib/record-card/model";
import { stepAssigneeOptions, stepEditFields, type TemperatureControl, type MenuItem, type CardKind } from "@/lib/record-card/rules";
import type { ReferralSource } from "@/lib/intake";
import {
  RECORD_CARD_ADD_STEP,
  RECORD_CARD_NO_SHOW_DONE,
  RECORD_CARD_NO_SHOW_NOTE,
  RECORD_CARD_NO_SHOW_PAUSED,
  RECORD_CARD_NO_SHOW_UNDO,
  RECORD_CARD_NO_SHOW_UNDONE,
  RECORD_CARD_NO_SOURCE,
  RECORD_CARD_SAVING,
  RECORD_CARD_SET_BTN,
  RECORD_CARD_STEP_DONE,
  RECORD_CARD_STEP_DUE,
  LEAD_PAGE_STEP_OWNER,
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
                  // A matter goes through the review's setSourceAction: it checks the role, the record and that the source is a listed one.
                  else run(viaForm(setRecordSourceAction, { kind: "matter", id, source: option }));
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

/**
 * Who a step is assigned to, offered only where the page passes the team (the Weekly review's card). `current` is the step's
 * assignee (edit) or the starting choice (add). Intake and Matters pass nothing and the form is unchanged.
 */
export type StepAssignees = { members: readonly CardMember[]; current: string | null };

/** Inline form for one step (edit) or a new one (add). Uses the review's existing actions; the role gate is theirs. */
export function StepForm({ kind, id, step, dueIso, onDone, autoFocus, assignees }: { kind: CardKind; id: string; step: Step | null; dueIso?: string | null; onDone: () => void; autoFocus?: boolean; assignees?: StepAssignees | null }) {
  const { pending, mark, run } = useRun(onDone);
  const [title, setTitle] = useState(step?.title ?? "");
  const [due, setDue] = useState(dueIso ?? "");
  // Edit: the picker opens on the step's real assignee (a former member gets their own option). Add: only the team is offered,
  // and a starting choice that isn't on it starts as Unassigned.
  const options = assignees ? stepAssigneeOptions(assignees.members, step ? assignees.current : null) : [];
  const [who, setWho] = useState(() => {
    const start = assignees?.current ?? "";
    return options.some((o) => o.value === start) ? start : "";
  });
  const [picked, setPicked] = useState(false);
  return (
    <form
      className={assignees ? "rc-stepform rc-stepform-who" : "rc-stepform"}
      onSubmit={(e) => {
        e.preventDefault();
        if (step) run(viaForm(updateNextStepAction, stepEditFields({ taskId: step.id, title, dueAt: due, assignees: assignees ?? null, chosen: who, picked })));
        else run(viaForm(setNextStepAction, { kind, id, title, dueAt: due, assigneeId: assignees ? who : "" }));
      }}
    >
      <input className="lx-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={TASK_TITLE_MAX} aria-label={RECORD_CARD_STEP_TITLE} placeholder="What happens next" required autoFocus={autoFocus} />
      <input className="lx-input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label={RECORD_CARD_STEP_DUE} />
      {assignees && (
        <select
          className="lx-input"
          value={who}
          onChange={(e) => {
            setWho(e.target.value);
            setPicked(true);
          }}
          aria-label={LEAD_PAGE_STEP_OWNER}
        >
          {options.map((o) => (
            <option key={o.value || "none"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
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

/**
 * Mark no-show: NOTHING is posted for 5 seconds; Undo inside the hold posts nothing; then ONE `call_logged` row. Typing the
 * optional note PAUSES the countdown (focus or a change pauses it, leaving the field starts a full 5 seconds again), so the
 * row is never posted with half a note. The menu item is offered only while `canMark` (`noShowOffered`): not during the hold,
 * not while the post is in flight, not after it saved.
 */
export function useNoShow(leadId: string, name: string) {
  const { mark, run } = useRun();
  const [held, setHeld] = useState(false);
  const [paused, setPaused] = useState(false);
  const [posted, setPosted] = useState(false);
  const [undone, setUndone] = useState(false);
  const holdRef = useRef<Hold | null>(null);
  const noteRef = useRef<HTMLInputElement | null>(null);
  const nameRef = useRef(name);
  useEffect(() => {
    nameRef.current = name;
  });
  // The card going away inside the hold (the opened card closed, the list re-drawn) cancels it and writes NOTHING. It is
  // never silent: a notice outside the card (`noShowNotices`, drawn by the dashboard layout) says it wasn't logged.
  useEffect(
    () => () => {
      if (holdRef.current?.cancel()) noShowNotices.push(nameRef.current);
    },
    [],
  );
  const canMark = noShowOffered({ held, posted, failed: Boolean(mark?.error) });
  const begin = () => {
    // A second request while one is held, in flight or saved is ignored: one hold, one post.
    if (holdRef.current?.settled() === "held") return;
    if (!canMark) return;
    setUndone(false);
    setPosted(false);
    setPaused(false);
    setHeld(true);
    holdRef.current = beginOnce(holdRef.current, () => {
      setHeld(false);
      setPosted(true);
      run(viaForm(logConsultOutcomeAction, { leadId, outcome: "no_show", note: noteRef.current?.value ?? "" }));
    });
  };
  const undo = () => {
    holdRef.current?.cancel();
    setHeld(false);
    setPaused(false);
    setUndone(true);
  };
  const pause = () => {
    if (holdRef.current?.pause()) setPaused(true);
  };
  const resume = () => {
    if (holdRef.current?.resume()) setPaused(false);
  };
  // "No-show logged." only from the action's own { saved: true }; never before it answers.
  const doneLine = undone ? RECORD_CARD_NO_SHOW_UNDONE : mark?.saved ? RECORD_CARD_NO_SHOW_DONE : null;
  const toast = held ? (
    <Toast
      action={
        <button type="button" className="lx-btn lx-btn-ghost lx-btn-sm" onClick={undo}>
          {RECORD_CARD_NO_SHOW_UNDO}
        </button>
      }
    >
      <span>{recordCardNoShowHeld(name)}</span>{" "}
      <input
        ref={noteRef}
        className="lx-input rc-noshow-note"
        aria-label={RECORD_CARD_NO_SHOW_NOTE}
        placeholder={RECORD_CARD_NO_SHOW_NOTE}
        maxLength={500}
        onFocus={pause}
        onChange={pause}
        onBlur={resume}
      />
      {paused && <span className="rc-noshow-paused">{RECORD_CARD_NO_SHOW_PAUSED}</span>}
    </Toast>
  ) : null;
  return { begin, toast, mark, doneLine, held, canMark };
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
                return !noShow.canMark ? null : (
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
      <SavedMarkView mark={mark ?? (noShow.mark?.error ? noShow.mark : null)} />
      {noShow.doneLine && !noShow.mark?.error && <span className="lx-saved" role="status">{noShow.doneLine}</span>}
      {noShow.toast}
    </span>
  );
}
