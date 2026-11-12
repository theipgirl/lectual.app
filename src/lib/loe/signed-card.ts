import { stepStates, STEP_SUCCESS, type StepEventInput } from "@/lib/proposals/paid";
import { stepText, type Tone } from "@/lib/proposals/paid-view";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import { SIGNED_CARD_UNAVAILABLE, SIGNED_FILING_NOT_YET, signedSummaryLine } from "@/lib/ui/words";
import type { SignatureRead } from "./signature-read";
import { rebuiltTextMatches } from "./signed-text-check";
import { signedAtText } from "./signing";

/**
 * What the staff "Engagement letter" card draws for an ACCEPTED version (Sprint 6). Pure: the page reads the signature row (three
 * states) and the version's step events and passes them in.
 *
 * The card exists only for an accepted version whose snapshot carries a letter (`content.loe`). A version with no letter, or one
 * that isn't accepted, draws NO card (`null`): no empty box.
 *
 * Two kinds of reader (`signature-roles.ts`):
 *  - A STAFF role may read the signature row, and the ROW is the source of the detail (signer, time, fingerprint, Download). A read
 *    that failed, or that came back with nothing, is "couldn't be loaded": never "not signed", and never "Signed" made up from the
 *    snapshot (the database hides nothing from these roles, so an empty answer is a problem to look at, not a fact about the client).
 *  - Any OTHER role (viewer, social media) is not asked at all: the page passes `signature: null`. The card says who signed and when
 *    from the accepted snapshot's `agreement` block, with no Download, no fingerprint and no filing state.
 */

export type FilingView = {
  state: "not_yet" | "done" | "failed" | "blocked" | "skipped" | "unreadable";
  text: string;
  tone: Tone;
  /** Try again is offered (failed, blocked or skipped; only to a role that may retry the other upload steps). */
  retry: boolean;
};

export type SignedCardView =
  | {
      kind: "signed";
      signer: string;
      signedLine: string;
      fingerprint: string;
      onBehalfOf: string | null;
      title: string | null;
      canDownload: boolean;
      /**
       * True when today's code no longer rebuilds the text that was signed, so the Download is produced from the stored signed
       * text (`buildVerifiedSignedPdf`). The card says so in one fixed sentence.
       */
      fromStoredText: boolean;
      filing: FilingView;
    }
  /** A role that may not read the signature record: who signed and when, from the snapshot. Nothing else. */
  | { kind: "summary"; text: string }
  | { kind: "unavailable"; text: string };

export const FILING_UNREADABLE = "Whether it was filed in Lawmatics couldn't be loaded. Refresh to try again.";

export function buildSignedCard(input: {
  proposalId: string;
  status: string;
  snapshot: AcceptedSnapshot | null | undefined;
  /** The signature row's read, or null when the caller's role may not read signature records (the read was not attempted). */
  signature: SignatureRead | null;
  /** The version's step events; null when that read failed. */
  events: readonly StepEventInput[] | null;
  tz: string;
  /** Owner / admin / senior admin / intake: the roles that may retry the other upload steps. */
  canRetry: boolean;
  /** A role that may read signature records (`canReadSignature`); nobody else downloads. */
  canDownload: boolean;
}): SignedCardView | null {
  if (input.status !== "accepted") return null;
  if (!input.snapshot?.content?.loe) return null;
  if (input.signature === null) {
    // Not a staff role: say only what the accepted snapshot itself records.
    const a = input.snapshot.agreement;
    if (!a || typeof a.signer_name !== "string" || !a.signer_name.trim()) return { kind: "unavailable", text: SIGNED_CARD_UNAVAILABLE };
    return { kind: "summary", text: signedSummaryLine(a.signer_name.trim(), signedAtText(a.signed_at, input.tz)) };
  }
  // A failed read and an empty one read the same for a staff role: couldn't be loaded. Never "not signed".
  if (input.signature.status !== "ok") return { kind: "unavailable", text: SIGNED_CARD_UNAVAILABLE };
  const sig = input.signature.signature;
  return {
    kind: "signed",
    signer: sig.signerName,
    signedLine: `Signed ${signedAtText(sig.signedAt, input.tz)}`.trim(),
    fingerprint: sig.fingerprint,
    onBehalfOf: sig.entityName,
    title: sig.signerTitle,
    canDownload: input.canDownload,
    fromStoredText: !rebuiltTextMatches(input.snapshot),
    filing: filingView(input.events, input.proposalId, input.canRetry),
  };
}

export function filingView(events: readonly StepEventInput[] | null, proposalId: string, canRetry: boolean): FilingView {
  if (events === null) return { state: "unreadable", text: FILING_UNREADABLE, tone: "warn", retry: false };
  const s = stepStates(events, proposalId).signed_loe_upload;
  if (!s) return { state: "not_yet", text: SIGNED_FILING_NOT_YET, tone: "mute", retry: false };
  if (s.outcome === STEP_SUCCESS.signed_loe_upload) return { state: "done", text: stepText(s), tone: "ok", retry: false };
  const state = s.outcome === "failed" ? "failed" : s.outcome === "skipped" ? "skipped" : "blocked";
  return { state, text: stepText(s), tone: state === "skipped" ? "mute" : "warn", retry: canRetry };
}
