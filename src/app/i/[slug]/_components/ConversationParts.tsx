import type { Ref } from "react";
import type { QuestionType } from "@/lib/intake-forms/choice";
import { ChoiceControl } from "./ChoiceControl";

/**
 * The conversation's presentational pieces (hook-free, so they render on the
 * server and are checked with a static render): the thread, and the input
 * below it. A text question gets the composer; a choice question gets its
 * options as tappable controls in place of the text box. The scripted flow
 * (what step is current, what advances) stays in PublicIntake's Conversation.
 */

export type ChatStep = {
  key: string;
  prompt: string;
  required: boolean;
  kind: "contact" | "question";
  type: QuestionType;
  options: readonly string[];
};

export type ThreadMessage = { who: "bot" | "you"; text: string };

/**
 * The thread so far: the opening, then each answered step as the question and
 * the answer (a choice shows the chosen label, a multi all of them joined), and
 * the question being asked now.
 */
export function buildThread(args: {
  opening: string;
  steps: readonly ChatStep[];
  answered: number;
  /** An answer as one line of text; "" when skipped. */
  textOf: (s: ChatStep) => string;
  current: ChatStep | null;
}): ThreadMessage[] {
  const thread: ThreadMessage[] = [{ who: "bot", text: args.opening }];
  args.steps.slice(0, args.answered).forEach((s) => {
    thread.push({ who: "bot", text: s.prompt });
    thread.push({ who: "you", text: args.textOf(s).trim() || "Skipped" });
  });
  if (args.current) thread.push({ who: "bot", text: args.current.prompt });
  return thread;
}

export function ThreadBubbles({ thread }: { thread: readonly ThreadMessage[] }) {
  return (
    <>
      {thread.map((m, i) => (
        <div key={i} className={`ipub-bubble ${m.who}`}>
          {m.text}
        </div>
      ))}
    </>
  );
}

const SEND_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export function ConversationInput(props: {
  step: ChatStep;
  /** The text box's value (text questions). */
  draft: string;
  maxLength: number;
  hint: string | null;
  /** Labels chosen so far (choice questions). */
  picked: readonly string[];
  inputRef?: Ref<HTMLTextAreaElement>;
  onDraft: (v: string) => void;
  onSend: () => void;
  onSkip: () => void;
  /** A choice was selected (tap, arrow key or Space): recorded only, for single and multi alike. */
  onPick: (next: string[]) => void;
  /** A single choice was confirmed by a tap or by Enter: the conversation goes on with it. */
  onCommit: (next: string[]) => void;
  /** The Done button: goes on with what is picked. */
  onDone: () => void;
}) {
  const { step, hint, draft, maxLength, picked, inputRef, onDraft, onSend, onSkip, onPick, onCommit, onDone } = props;
  const hintLine = hint && <p className="ipub-error">{hint}</p>;
  if (step.type !== "text") {
    const multi = step.type === "multi";
    return (
      <div className="ipub-composer-wrap">
        {hintLine}
        <ChoiceControl
          name={`chat-${step.key}`}
          type={multi ? "multi" : "single"}
          options={step.options}
          value={picked}
          label={step.prompt}
          layout="chat"
          onChange={onPick}
          onCommit={multi ? undefined : onCommit}
        />
        <div className="ipub-choice-actions">
          {!step.required && (
            <button type="button" className="ipub-skip" onClick={onSkip}>
              Skip
            </button>
          )}
          <button type="button" className="ipub-submit" onClick={onDone}>
            Done
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="ipub-composer-wrap">
      {hintLine}
      <div className="ipub-composer">
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          maxLength={maxLength}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          placeholder="Type your answer…"
          aria-label={step.prompt}
        />
        {!step.required && (
          <button type="button" className="ipub-skip" onClick={onSkip}>
            Skip
          </button>
        )}
        <button type="button" className="ipub-send" onClick={onSend} aria-label="Send">
          {SEND_ICON}
        </button>
      </div>
    </div>
  );
}
