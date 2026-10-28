import { DID_NOT_FINISH_ERROR } from "./run-status";
import { LECTUAL_TOLD } from "@/lib/ui/words";

/** Said for any stored error this file does not recognise: never the stored text itself. */
export const RUN_FAILED_FALLBACK = `This run failed. ${LECTUAL_TOLD}`;
export const RUN_TIME_LIMIT_SENTENCE = "It ran out of time before it finished. Try Run now again later.";
export const RUN_RECONNECT_MAILBOX_SENTENCE = "A mailbox needs to be reconnected. Reconnect it in Settings, then try again.";
export const RUN_RECONNECT_MEETINGS_SENTENCE = "A meeting source needs to be reconnected. Reconnect it in Settings, then try again.";
export const RUN_BUSY_SENTENCE = "The AI service was busy or slow. Try Run now again later.";

/**
 * A stored `agent_run.error` as a person reads it. The stored text can carry a provider's
 * message, so only the causes `failureAction` already recognises are put in plain words; anything
 * else (including text this function has never seen) gets one fixed sentence. A missing error reads
 * "Failed". Pure.
 */
export function friendlyRunError(raw: string | null | undefined): string {
  const e = (raw ?? "").trim();
  if (!e) return "Failed";
  if (e === DID_NOT_FINISH_ERROR) return RUN_TIME_LIMIT_SENTENCE;
  const lower = e.toLowerCase();
  if (/ran out of time/.test(lower)) return RUN_TIME_LIMIT_SENTENCE;
  if (/mailbox|reconnect|refresh token|oauth|invalid_grant|\b40[13]\b/.test(lower)) return RUN_RECONNECT_MAILBOX_SENTENCE;
  if (/fathom|zoom/.test(lower)) return RUN_RECONNECT_MEETINGS_SENTENCE;
  if (/anthropic|overloaded|rate limit|\b429\b|\b529\b|timeout|timed out|time limit/.test(lower)) return RUN_BUSY_SENTENCE;
  return RUN_FAILED_FALLBACK;
}
