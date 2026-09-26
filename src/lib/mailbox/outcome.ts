/**
 * The result of a connect attempt, carried back to the Mailboxes page as a
 * query parameter. Codes only — never a provider's raw text or anything from
 * the callback URL — so nothing an attacker puts in a link is echoed back.
 */
export const OUTCOME_MESSAGES = {
  denied: "The connection was cancelled on the sign-in screen. Nothing was saved.",
  expired: "That connection attempt expired or was started in another tab. Please try again.",
  "wrong-session":
    "You switched account or firm partway through. Nothing was saved — start again from this page.",
  unconfigured: "Mailbox connections aren't set up on this deployment yet.",
  forbidden: "Only an owner, admin or senior admin can connect a firm mailbox.",
  "missing-permission":
    "Some permissions weren't granted. Lectual needs to read mail and create drafts; please allow both.",
  "no-refresh-token": "The provider didn't allow background access. Please try connecting again.",
  taken: "Someone in your firm has already connected that mailbox.",
  "scope-conflict": "That address is already connected here in a different way (personal vs firm).",
  failed: "We couldn't finish connecting the mailbox. Please try again.",
} as const;

export type OutcomeCode = keyof typeof OUTCOME_MESSAGES;

export function outcomeMessage(code: string | undefined): string | null {
  return code && code in OUTCOME_MESSAGES ? OUTCOME_MESSAGES[code as OutcomeCode] : null;
}

export const MAILBOXES_PATH = "/dashboard/settings/mailboxes/";
