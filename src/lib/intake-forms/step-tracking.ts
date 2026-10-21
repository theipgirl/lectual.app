/**
 * The browser's half of per-step tracking (Sprint 10): decides what to send,
 * once, and swallows everything that can go wrong. Pure, so the rules are
 * tested without a DOM; the pages hand it the server action as `send`.
 *
 * Rules:
 *  - nothing is sent before the contact step has produced a token;
 *  - each question is sent once per page load (switching between chat and form
 *    does not send it again);
 *  - a call that throws, rejects or is refused never reaches the person: the
 *    intake is never slowed, blocked or told about it.
 */

export type StepCall = {
  token: string;
  stepIndex: number;
  questionId: string;
  /** The answers so far, as the page holds them. The server rebuilds what it keeps. */
  progress: Record<string, unknown>;
};

export type StepSender = (call: StepCall) => Promise<unknown> | unknown;

/** True when a step should go out now; marks it sent. */
export function shouldSendStep(sent: Set<string>, token: string | null | undefined, questionId: string): boolean {
  if (!token || sent.has(questionId)) return false;
  sent.add(questionId);
  return true;
}

export function createStepTracker(send: StepSender, sent: Set<string> = new Set()) {
  return {
    sent,
    /** Fire and forget. Returns nothing, whatever happens. */
    track(call: Omit<StepCall, "token"> & { token: string | null | undefined }): void {
      if (!shouldSendStep(sent, call.token, call.questionId)) return;
      try {
        Promise.resolve(send({ ...call, token: call.token as string })).catch(() => {});
      } catch {
        // a synchronous throw is swallowed the same way
      }
    },
  };
}
