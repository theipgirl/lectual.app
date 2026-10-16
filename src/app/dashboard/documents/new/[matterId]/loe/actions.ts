"use server";
import { orgHasModule } from "@/lib/org/modules";

import { redirect } from "next/navigation";
import { generateTrademarkLoe, generateGeneralLoe } from "@/lib/documents/generate";
import { DocumentFlowError } from "@/lib/documents/errors";
import type { LoeSignedQuoteSource, LoeTemplateVariant } from "@/lib/documents/loe";
import { loeDifferences, type LoePrefill, type LoeSubmitted } from "@/lib/documents/loe-prefill";
import { prefillForSignedQuote, type SignedQuotePrefill } from "@/lib/documents/loe-prefill-load";

export type LoeState = { error?: string };

function numOrNull(v: FormDataEntryValue | null): number | null {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const SIGNED_QUOTE_REFUSAL: Record<Extract<SignedQuotePrefill, { ok: false }>["reason"], string> = {
  matter_not_found: "Matter not found.",
  not_signed: "That isn't a signed quote on this matter. Reload the page and choose again.",
  unreadable:
    "That quote is signed, but its signed copy can't be read, so the letter can't be checked against it. Reload the page and fill it in by hand.",
  unavailable: "We couldn't check the signed quote just now. Nothing was generated; try again in a moment.",
};

/** The source block the draft carries when the form was opened from a signed quote. */
function sourceOf(prefill: LoePrefill | null, submitted: LoeSubmitted): LoeSignedQuoteSource | null {
  if (!prefill) return null;
  return {
    quoteId: prefill.quoteId,
    reference: prefill.reference,
    acceptedOn: prefill.acceptedOn,
    differences: loeDifferences(prefill, submitted),
  };
}

/**
 * One action for both LOE paths (trademark fee chart / general AI-summarized
 * scope) — routed on the "kind" field the form sets, per
 * draft-engagement-letter's two-path SOP. matterId travels as a hidden
 * field, same convention as every other matter form action.
 *
 * When the form was opened from a SIGNED quote it also carries `quoteId`. That
 * id is checked here against the matter's signed quotes (never trusted), and
 * the submitted figures are compared with the signed snapshot so that any edit
 * is printed for the approver. The template variant is not part of any of it:
 * it is read from the form and refused when absent, signed quote or not.
 */
export async function generateLoeAction(_prev: LoeState, formData: FormData): Promise<LoeState> {
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return { error: "Missing matter." };

  // A "use server" function is its own POST entry point and never renders the
  // segment layout that gates the pages, so this re-checks the module itself.
  // Without it a firm without the Document Center could still invoke the
  // generator directly and receive a letter signed by another firm's attorney.
  if (!(await orgHasModule("document-center"))) {
    return { error: "This isn't available for your firm." };
  }

  const kind = String(formData.get("kind") ?? "");
  const clientName = String(formData.get("clientName") ?? "").trim();
  const entityName = String(formData.get("entityName") ?? "").trim() || null;
  if (!clientName) return { error: "Client name is required." };

  let prefill: LoePrefill | null = null;
  const quoteId = String(formData.get("quoteId") ?? "").trim();
  if (quoteId) {
    const checked = await prefillForSignedQuote(matterId, quoteId);
    if (!checked.ok) return { error: SIGNED_QUOTE_REFUSAL[checked.reason] };
    prefill = checked.prefill;
  }

  let result: { queueItemId: string } | null = null;
  try {
    if (kind === "trademark") {
      const variant = String(formData.get("variant") ?? "");
      if (variant !== "current" && variant !== "legacy") {
        return {
          error:
            "Select a template — current or legacy — before generating. This is never guessed.",
        };
      }
      const markText = String(formData.get("markText") ?? "").trim();
      const packageName = String(formData.get("packageName") ?? "").trim();
      const classSelected = String(formData.get("classSelected") ?? "").trim();
      const classCount = Number(formData.get("classCount") ?? 0);
      const amountPaid = String(formData.get("amountPaid") ?? "").trim();
      const amountPaidMath = String(formData.get("amountPaidMath") ?? "").trim() || null;
      const benefitRowsText = String(formData.get("benefitRowsText") ?? "");
      const govFeesText = String(formData.get("govFeesText") ?? "").trim() || null;
      if (!markText || !packageName || !classSelected || !amountPaid || !classCount) {
        return { error: "Mark, package, class(es), class count, and amount paid are all required." };
      }

      result = await generateTrademarkLoe({
        matterId,
        variant: variant as LoeTemplateVariant,
        clientName,
        entityName,
        markText,
        packageName,
        benefitRowsText,
        classSelected,
        classCount,
        amountPaid,
        amountPaidMath,
        govFeesText,
        signedQuote: sourceOf(prefill, {
          packageName,
          markText,
          classCount,
          amountPaid,
          amountPaidMath: amountPaidMath ?? "",
          govFeesText: govFeesText ?? "",
          benefitRowsText,
        }),
        sendDateIso: new Date().toISOString().slice(0, 10),
      });
    } else if (kind === "general") {
      const scopeDescription = String(formData.get("scopeDescription") ?? "").trim();
      const feeStructure = String(formData.get("feeStructure") ?? "").trim();
      const depositStatedTerms = String(formData.get("depositStatedTerms") ?? "").trim() || null;
      if (!scopeDescription || !feeStructure) {
        return { error: "Scope description and fee structure are required." };
      }
      const quotedAmount = numOrNull(formData.get("quotedAmount"));

      result = await generateGeneralLoe({
        matterId,
        clientName,
        entityName,
        scopeDescription,
        feeStructure,
        depositStatedTerms,
        depositPercent: numOrNull(formData.get("depositPercent")),
        quotedAmount,
        signedQuote: sourceOf(prefill, { quotedAmount, feeStructure, scopeDescription }),
      });
    } else {
      return { error: "Choose Trademark or General before generating." };
    }
  } catch (err) {
    return {
      error: err instanceof DocumentFlowError ? err.message : "Something went wrong generating the LOE.",
    };
  }

  if (!result) return { error: "Something went wrong generating the LOE." };
  redirect(`/dashboard/queue/${result.queueItemId}/`);
}
