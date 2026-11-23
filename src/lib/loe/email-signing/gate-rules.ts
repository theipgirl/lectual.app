/**
 * The emailed-signing gate's decision, pure (Sprint A item 1). ON only when ALL hold, judged in this order:
 *   1. the deployment switch `LOE_EMAIL_SIGNING` is exactly "on" (anything else: `switch_off`, and nothing is read);
 *   2. mail is configured for THIS firm: `RESEND_API_KEY` and a `FIRM_CLIENT_MAIL_FROM` entry for its org id (`no_mail`);
 *   3. 0117 is fully applied: the runtime memo is clear and `client_proposal_signing_probe()` answers 117 (`not_set_up`; any
 *      other failure of the probe is `unreadable`);
 *   4. the firm has APPROVED signing words (`no_words`; a missing table is `not_set_up`; any other failure `unreadable`).
 * Every `on: false` means today's in-app path.
 */

export type GateReason = "switch_off" | "not_set_up" | "no_mail" | "no_words" | "unreadable";

export type ProbeFact = "ok" | "missing" | "error";
export type WordsFact = "approved" | "none" | "missing" | "error";

export type GateFacts = {
  switchValue: string | undefined;
  hasKey: boolean;
  hasFrom: boolean;
  memoNotSetUp: boolean;
  /** Undefined when not read (an earlier condition already decided). */
  probe?: ProbeFact;
  words?: WordsFact;
};

export type GateDecision = { on: true } | { on: false; reason: GateReason };

/** The checks still needed after what is known: the I/O half calls the probe and the words read only when this says so. */
export function gateDecision(f: GateFacts): GateDecision | "need_probe" | "need_words" {
  if (f.switchValue !== "on") return { on: false, reason: "switch_off" };
  if (!f.hasKey || !f.hasFrom) return { on: false, reason: "no_mail" };
  if (f.memoNotSetUp) return { on: false, reason: "not_set_up" };
  if (f.probe === undefined) return "need_probe";
  if (f.probe === "missing") return { on: false, reason: "not_set_up" };
  if (f.probe === "error") return { on: false, reason: "unreadable" };
  if (f.words === undefined) return "need_words";
  if (f.words === "missing") return { on: false, reason: "not_set_up" };
  if (f.words === "error") return { on: false, reason: "unreadable" };
  if (f.words === "none") return { on: false, reason: "no_words" };
  return { on: true };
}
