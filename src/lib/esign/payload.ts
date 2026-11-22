import { endOfFirmDay } from "@/lib/quotes/firm-time";
import { resolveTimeZone } from "@/lib/org/profile-rules";
import { clientLinkUrl } from "@/lib/proposals/client-link-origin";

/**
 * The bodies sent to Adobe Acrobat Sign when a client presses "Continue to Adobe to sign" (Sprint 5a, contract item 7). PURE.
 *
 * ── WHAT THIS GUARANTEES (acceptance test 4) ────────────────────────────────────────────────────────────────────────────────
 *  - Exactly ONE participant set, role `SIGNER`, one member: the client's email and the name the client TYPED. No firm
 *    countersign, no HOST / IN_PERSON_SIGNER, no second signer.
 *  - Every Adobe notification on the participant set is disabled, and every email option is `NONE`. No reminders are set and
 *    no reminder endpoint exists in this module. Lectual never causes mail to a client.
 *  - The proposal's public token appears ONCE, in `postSignOption.redirectUrl` (the client's own link, built by
 *    `clientLinkUrl`, plus `?signed=adobe`). Adobe shows `externalId` to participants, so it carries the request uuid; the
 *    agreement name and the file name carry neither.
 *  - `expirationTime` is the end of the proposal's last day (`expires_on`) in the firm's zone, as an ISO instant.
 */

export const DISABLED_NOTIFICATION_TYPES = ["INITIAL", "INTERMEDIATE", "FINAL", "CANCELLATION", "REMINDER"] as const;
export const SEND_OPTIONS = { initEmails: "NONE", inFlightEmails: "NONE", completionEmails: "NONE" } as const;
/** The events a per-agreement webhook asks for (the webhook route itself is Sprint 5b). */
export const WEBHOOK_EVENTS = ["AGREEMENT_WORKFLOW_COMPLETED", "AGREEMENT_RECALLED", "AGREEMENT_REJECTED", "AGREEMENT_EXPIRED"] as const;
/** The path Adobe posts to. Provider-neutral (D2). */
export const WEBHOOK_PATH = "/api/esign/webhook/";
/** Appended to the client's link for Adobe's redirect after signing. A hint only: it never marks anything signed. */
export const SIGNED_HINT = "?signed=adobe";
export const MAX_AGREEMENT_NAME = 255;
/** The uploaded file's name: no token, no client name. */
export const SIGNING_FILE_NAME = "engagement-letter.pdf";

/** "<letter title> - <typed name>", at most 255 characters. Never the token. */
export function agreementName(letterTitle: string, typedName: string): string {
  const title = (letterTitle || "Engagement letter").replace(/\s+/g, " ").trim();
  const name = typedName.replace(/\s+/g, " ").trim();
  return (name ? `${title} - ${name}` : title).slice(0, MAX_AGREEMENT_NAME);
}

/** Where Adobe sends the client back once they have signed: their own proposal link, with the hint. */
export function postSignRedirect(origin: string, token: string): string {
  return `${clientLinkUrl(origin, token)}${SIGNED_HINT}`;
}

/** The end of `expiresOn` in the firm's zone as an ISO instant, or null when there is no (readable) expiry. */
export function expirationInstant(expiresOn: string | null | undefined, timeZone: string): string | null {
  if (typeof expiresOn !== "string") return null;
  return endOfFirmDay(expiresOn, resolveTimeZone(timeZone));
}

export type AgreementPayloadInput = {
  transientDocumentId: string;
  /** The proposal's own client email (never typed on the page). */
  signerEmail: string;
  /** The name the client TYPED on our page. */
  signerName: string;
  /** `client_proposal_esign_request.id`. */
  requestId: string;
  letterTitle: string;
  /** From `expirationInstant`; omitted when null. */
  expirationTime: string | null;
  /** From `postSignRedirect`. */
  redirectUrl: string;
};

export function agreementPayload(i: AgreementPayloadInput): Record<string, unknown> {
  return {
    fileInfos: [{ transientDocumentId: i.transientDocumentId }],
    name: agreementName(i.letterTitle, i.signerName),
    participantSetsInfo: [
      {
        order: 1,
        role: "SIGNER",
        memberInfos: [{ email: i.signerEmail, name: i.signerName }],
        disabledNotificationTypes: [...DISABLED_NOTIFICATION_TYPES],
      },
    ],
    signatureType: "ESIGN",
    state: "IN_PROCESS",
    emailOption: { sendOptions: { ...SEND_OPTIONS } },
    externalId: { id: i.requestId },
    ...(i.expirationTime ? { expirationTime: i.expirationTime } : {}),
    postSignOption: { redirectUrl: i.redirectUrl, redirectDelay: 0 },
  };
}

/** A RESOURCE-scoped webhook for one agreement. Never asks for the signed documents in the body. */
export function webhookPayload(agreementId: string, webhookUrl: string): Record<string, unknown> {
  return {
    name: "Lectual engagement letter",
    scope: "RESOURCE",
    state: "ACTIVE",
    resourceType: "AGREEMENT",
    resourceId: agreementId,
    webhookSubscriptionEvents: [...WEBHOOK_EVENTS],
    webhookUrlInfo: { url: webhookUrl },
  };
}

/** Cancelling an agreement, with the cancellation email OFF. */
export function cancelPayload(): Record<string, unknown> {
  return { state: "CANCELLED", agreementCancellationInfo: { comment: "", notifyOthers: false } };
}
