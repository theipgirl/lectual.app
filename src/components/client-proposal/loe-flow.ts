"use client";

import { useMemo, useState } from "react";
import { money } from "./format";
import { buildExhibit } from "@/lib/loe/exhibit";
import {
  assembleAgreement,
  canSign,
  cleanSigningDetails,
  emptyDetails,
  letterDateText,
  missingDetails,
  pageAgreement,
  pageSigningPayload,
  type Agreement,
  type PageSigningState,
  type SignerDetails,
  type SigningInput,
} from "@/lib/loe/signing";
import type { PublicLetterView } from "@/lib/proposals/public";
import type { ProposalContent, ProposalQuote } from "@/lib/proposals/types";
import type { SignedLetter } from "@/lib/loe/signed-letter";

/**
 * The engagement-letter state of the client page: which step the client is on, what they typed, the letter and exhibit built
 * from it, and the fingerprint of exactly that. Shared by the trademark and flat-fee pages. Runs only for content with `loe`.
 *
 * Nothing here decides money: the exhibit is built from the page's own quote (`quoteWithClientClasses`), the same quote the
 * totals panel draws and the server recomputes at signing.
 */

export type LoeStep = 1 | 2 | 3;

export type LoeLetterData = Pick<PublicLetterView, "dateText" | "clientEmail"> & { signed?: SignedLetter | null };

export type LoeFlowInput = {
  /** The letter the proposal carries, or null (no letter: the flow is off and nothing here runs). */
  loe: { title: string; body: string } | null;
  clientName: string;
  company: string;
  letter: LoeLetterData | null;
  /** The EFFECTIVE content and its quote (the client's own class words included): what Exhibit A is built from. */
  shown: ProposalContent;
  quote: ProposalQuote;
  initialStep?: LoeStep;
  initialDetails?: SignerDetails;
  initialTypedName?: string;
  initialAgree?: boolean;
  /**
   * After a successful signing: the letter's date as the SERVER stamped it (the firm's calendar date at signing). The page was
   * built with the date at page load; once signed, the letter shown is redrawn with the date that was actually stored.
   */
  signedDateText?: string | null;
};

/** Shown in a letter preview before the client has typed anything, so a merge field never reads as a blank line. */
const PLACEHOLDER_NAME = "[your full legal name]";
const PLACEHOLDER_ADDRESS = "[your address]";

export function startingDetails(clientName: string, company: string, given?: SignerDetails): SignerDetails {
  return given ?? { ...emptyDetails(), client_name: clientName.trim(), entity_name: company.trim() };
}

export function useLoeFlow(input: LoeFlowInput) {
  const enabled = input.loe !== null;
  const [step, setStep] = useState<LoeStep>(input.initialStep ?? 1);
  const [details, setDetails] = useState<SignerDetails>(() => startingDetails(input.clientName, input.company, input.initialDetails));
  const [typedName, setTypedName] = useState(input.initialTypedName ?? "");
  const [agree, setAgree] = useState(input.initialAgree ?? false);

  const cleaned = useMemo(() => cleanSigningDetails(details), [details]);
  const detailsOk = missingDetails(cleaned).length === 0;
  const exhibit = useMemo(() => (enabled ? buildExhibit(input.shown, input.quote, money) : null), [enabled, input.shown, input.quote]);

  // The public page always passes the letter's date (worked out on the server in the firm's zone). The staff preview passes none, so it shows today.
  const dateText = input.signedDateText || input.letter?.dateText || letterDateText(new Date(), "UTC");
  const clientEmail = input.letter?.clientEmail ?? "";
  const body = input.loe?.body ?? "";

  /** What the client typed, as the inputs hold it. `pageAgreement` / `pageSigningPayload` clean it exactly as the server does. */
  const state: PageSigningState | null = useMemo(
    () => (enabled && exhibit ? { body, details, typedName, dateText, clientEmail, exhibit } : null),
    [enabled, body, details, typedName, dateText, clientEmail, exhibit],
  );

  /** The letter the client would sign: their cleaned details and typed name merged in. Null if the stored letter will not merge. */
  const agreement: Agreement | null = useMemo(() => (state ? pageAgreement(state) : null), [state]);

  /** A read-only preview for step 1, before any details exist: blanks become bracketed prompts. */
  const preview: Agreement | null = useMemo(() => {
    if (!enabled || !exhibit) return null;
    const filled: SignerDetails = {
      ...cleaned,
      client_name: cleaned.client_name || PLACEHOLDER_NAME,
      street: cleaned.street || PLACEHOLDER_ADDRESS,
    };
    const r = assembleAgreement({ body, inputs: { details: filled, typedName: "", dateText, clientEmail }, exhibit });
    return r.ok ? r.agreement : null;
  }, [enabled, body, cleaned, dateText, clientEmail, exhibit]);

  /** Whether the page can sign: the letter merged and the name and tick given (the same rule the server applies). */
  const signable = enabled && agreement !== null && canSign({ typedName, agree, details: cleaned });

  /**
   * What the sign action posts. The fingerprint is hashed with Web Crypto (async) at the moment of signing, over the letter,
   * details and exhibit the page is showing with the date fields fixed (`Agreement.canonical`), so the server's date at
   * signing never makes it disagree. Null while the page cannot sign.
   */
  async function signingPayload(): Promise<SigningInput | null> {
    if (!signable || !state) return null;
    return pageSigningPayload({ ...state, agree });
  }

  return {
    enabled,
    step,
    setStep,
    details,
    setDetail: (key: keyof SignerDetails, value: string) => setDetails((prev) => ({ ...prev, [key]: value })),
    cleaned,
    detailsOk,
    typedName,
    setTypedName,
    agree,
    setAgree,
    agreement,
    preview,
    exhibit,
    signable,
    signingPayload,
  };
}

export type LoeFlow = ReturnType<typeof useLoeFlow>;
