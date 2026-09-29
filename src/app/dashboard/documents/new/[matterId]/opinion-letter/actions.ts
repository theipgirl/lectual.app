"use server";
import { orgHasModule } from "@/lib/org/modules";

import { redirect } from "next/navigation";
import { generateOpinionLetter } from "@/lib/documents/generate";
import { DocumentFlowError } from "@/lib/documents/errors";

export type OpinionLetterState = { error?: string };

/**
 * Extracts the uploaded TMTKO report, runs the opinion-letter SOP via
 * Claude, and queues the draft (src/lib/documents/generate.ts). On success,
 * lands the reviewer straight on the new queue item — matching every other
 * "just queued" flow in the app.
 *
 * matterId travels as a hidden form field (same convention as
 * MatterStatusForm/MatterStageForm), not a bound argument — useActionState
 * requires the exact (prevState, formData) shape.
 */
export async function generateOpinionLetterAction(
  _prev: OpinionLetterState,
  formData: FormData,
): Promise<OpinionLetterState> {
  const matterId = String(formData.get("matterId") ?? "");
  if (!matterId) return { error: "Missing matter." };

  // A "use server" function is its own POST entry point and never renders the
  // segment layout that gates the pages, so this re-checks the module itself.
  // Without it a firm without the Document Center could still invoke the
  // generator directly and receive a letter signed by another firm's attorney.
  if (!(await orgHasModule("document-center"))) {
    return { error: "This isn't available for your firm." };
  }

  const file = formData.get("upload");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Upload the TMTKO search report (PDF or .docx) before generating." };
  }

  const honorific = String(formData.get("honorific") ?? "").trim();
  const entityName = String(formData.get("entityName") ?? "").trim();
  const markType = formData.get("markType") === "design mark" ? "design mark" : "word mark";

  let result: { queueItemId: string };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    result = await generateOpinionLetter({
      matterId,
      upload: { bytes, mime: file.type, fileName: file.name },
      markType,
      honorific,
      entityName,
    });
  } catch (err) {
    return {
      error:
        err instanceof DocumentFlowError
          ? err.message
          : "Something went wrong generating the opinion letter. Try again, or check that this deployment has an AI provider configured.",
    };
  }

  redirect(`/dashboard/queue/${result.queueItemId}/`);
}
