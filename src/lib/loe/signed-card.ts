import { stepStates, STEP_SUCCESS, type StepEventInput } from "@/lib/proposals/paid";
import { stepText, type Tone } from "@/lib/proposals/paid-view";
import type { AcceptedSnapshot } from "@/lib/proposals/types";
import {
  SIGNED_CARD_NOT_FOUND,
  SIGNED_CARD_UNAVAILABLE,
  SIGNED_FILING_NOT_YET,
} from "@/lib/ui/words";
import type { SignatureRead } from "./signature-read";
import { signedAtText } from "./signing";

/**
 * What the staff "Engagement letter" card draws for an ACCEPTED version (Sprint 6). Pure: the page reads the signature row (three
 * states) and the version's step events and passes them in.
 *
 * The card exists only for an accepted version whose snapshot carries a letter (`content.loe`). A version with no letter, or one
 * that isn't accepted, draws NO card (`null`): no empty box. The signature ROW is the source of the detail; the snapshot alone never
 * makes a version "Signed" here, so a missing row says it wasn't found and a failed read says it couldn't be loaded.
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
      filing: FilingView;
    }
  | { kind: "not_found"; text: string }
  | { kind: "unavailable"; text: string };

export const FILING_UNREADABLE = "Whether it was filed in Lawmatics couldn't be loaded. Refresh to try again.";

export function buildSignedCard(input: {
  proposalId: string;
  status: string;
  snapshot: AcceptedSnapshot | null | undefined;
  signature: SignatureRead;
  /** The version's step events; null when that read failed. */
  events: readonly StepEventInput[] | null;
  tz: string;
  /** Owner / admin / senior admin / intake: the roles that may retry the other upload steps. */
  canRetry: boolean;
  /** A proposal-writing role (viewer and social media never download). */
  canDownload: boolean;
}): SignedCardView | null {
  if (input.status !== "accepted") return null;
  if (!input.snapshot?.content?.loe) return null;
  if (input.signature.status === "unavailable") return { kind: "unavailable", text: SIGNED_CARD_UNAVAILABLE };
  if (input.signature.status === "none") return { kind: "not_found", text: SIGNED_CARD_NOT_FOUND };
  const sig = input.signature.signature;
  return {
    kind: "signed",
    signer: sig.signerName,
    signedLine: `Signed ${signedAtText(sig.signedAt, input.tz)}`.trim(),
    fingerprint: sig.fingerprint,
    onBehalfOf: sig.entityName,
    title: sig.signerTitle,
    canDownload: input.canDownload,
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
