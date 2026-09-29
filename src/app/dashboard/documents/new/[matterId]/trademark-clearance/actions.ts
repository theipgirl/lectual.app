"use server";
import { orgHasModule } from "@/lib/org/modules";

import { redirect } from "next/navigation";
import { generateTrademarkClearance } from "@/lib/documents/generate";
import { DocumentFlowError } from "@/lib/documents/errors";
import type { TrademarkClearanceFilingBasis } from "@/lib/documents/trademark-clearance";

export type TrademarkClearanceState = { error?: string };

/**
 * Runs the trademark-clearance SOP against the matter's on-file facts plus
 * the staff-pasted preliminary search findings, and queues the draft
 * (src/lib/documents/generate.ts). Same "land on the new queue item" success
 * shape as generateOpinionLetterAction. matterId travels as a hidden field,
 * same convention as every other Document Center form.
 */
export async function generateTrademarkClearanceAction(
  _prev: TrademarkClearanceState,
  formData: FormData,
): Promise<TrademarkClearanceState> {
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return { error: "Missing matter." };

  // A "use server" function is its own POST entry point and never renders the
  // segment layout that gates the pages, so this re-checks the module itself.
  // Without it a firm without the Document Center could still invoke the
  // generator directly and receive a letter signed by another firm's attorney.
  if (!(await orgHasModule("document-center"))) {
    return { error: "This isn't available for your firm." };
  }

  const filingBasisRaw = String(formData.get("filingBasis") ?? "");
  if (filingBasisRaw !== "1(a) Use in Commerce" && filingBasisRaw !== "1(b) Intent-to-Use") {
    return { error: "Select the proposed filing basis before generating." };
  }
  const filingBasis = filingBasisRaw as TrademarkClearanceFilingBasis;

  const entityName = String(formData.get("entityName") ?? "").trim();
  const searchFindings = String(formData.get("searchFindings") ?? "").trim();
  if (!searchFindings) {
    return { error: "Paste in the preliminary search findings before generating." };
  }

  let result: { queueItemId: string };
  try {
    result = await generateTrademarkClearance({
      matterId,
      filingBasis,
      entityName,
      searchFindings,
    });
  } catch (err) {
    return {
      error:
        err instanceof DocumentFlowError
          ? err.message
          : "Something went wrong generating the trademark clearance opinion. Try again, or check that this deployment has an AI provider configured.",
    };
  }

  redirect(`/dashboard/queue/${result.queueItemId}/`);
}
