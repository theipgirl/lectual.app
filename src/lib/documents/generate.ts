import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getMatter } from "@/lib/matters/matters";
import { resolveMatterClientName } from "@/lib/matters/client-name";
import { getLead } from "@/lib/pipeline/leads";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { createDraft } from "@/lib/queue/api";
import { DocumentFlowError } from "./errors";
import {
  requireDocumentWriteRole,
  createDocumentDraft,
  attachQueueItemId,
  deleteDocumentDraft,
} from "./store";
import { QUEUE_TYPE_FOR_DOC, type DocType } from "./types";
import { extractTextFromUpload } from "./extract";
import { buildOpinionLetterDraft, type OpinionLetterMatterFacts } from "./opinion-letter";
import {
  buildTrademarkClearanceDraft,
  type TrademarkClearanceMatterFacts,
  type TrademarkClearanceFilingBasis,
} from "./trademark-clearance";
import {
  buildTrademarkLoeDraft,
  buildGeneralLoeDraft,
  type TrademarkLoeInput,
  type GeneralLoeInput,
} from "./loe";

/**
 * Shared "build content, then queue it" plumbing for both Document Center
 * flows. Every path here:
 *   1. Confirms the caller may write this matter (requireDocumentWriteRole).
 *   2. Confirms this firm has a queue wired up at all — no queue key means
 *      there is nowhere for the draft to go, and generating content nobody
 *      can review would be worse than refusing up front.
 *   3. Builds the draft text (opinion-letter.ts / loe.ts).
 *   4. Writes the crm_document_draft bookkeeping row, THEN queues it. If the
 *      queue POST fails, the bookkeeping row is deleted rather than left
 *      dangling with no queue_item_id — see store.ts's deleteDocumentDraft.
 * Real .docx generation does not happen here — only at approval
 * (src/lib/documents/approve-hook.ts), per the MVP shape.
 */

async function queueBuiltDraft(args: {
  matterId: string;
  orgId: string;
  docType: DocType;
  agent: string;
  headline: string;
  summary: string;
  draftBody: string;
  clientName: string;
  payload: Record<string, unknown>;
}): Promise<{ draftId: string; queueItemId: string }> {
  const orgKey = await activeQueueOrgKey();
  if (!orgKey) {
    throw new DocumentFlowError(
      "Approvals aren't enabled for this firm yet — ask an admin to set up the approval queue before generating documents.",
    );
  }

  const supabase = await getScopedClient();
  const draft = await createDocumentDraft(supabase, {
    matterId: args.matterId,
    orgId: args.orgId,
    docType: args.docType,
    payload: args.payload,
  });

  try {
    const { id: queueItemId } = await createDraft({
      orgKey,
      agent: args.agent,
      type: QUEUE_TYPE_FOR_DOC[args.docType],
      headline: args.headline,
      draftBody: args.draftBody,
      summary: args.summary,
      matterId: args.matterId,
      clientName: args.clientName,
    });
    await attachQueueItemId(supabase, draft.id, queueItemId);
    return { draftId: draft.id, queueItemId };
  } catch (err) {
    await deleteDocumentDraft(supabase, draft.id).catch(() => {});
    throw err;
  }
}

export type OpinionLetterFormInput = {
  matterId: string;
  upload: { bytes: Uint8Array; mime: string; fileName: string };
  markType: "word mark" | "design mark";
  honorific: string;
  entityName: string;
};

/** Extracts the upload, runs the opinion-letter SOP, and queues the draft. */
export async function generateOpinionLetter(
  input: OpinionLetterFormInput,
): Promise<{ draftId: string; queueItemId: string }> {
  const supabase = await getScopedClient();
  await requireDocumentWriteRole(supabase);

  const matter = await getMatter(input.matterId);
  if (!matter) throw new DocumentFlowError("Matter not found.");
  if (!matter.mark_text) {
    throw new DocumentFlowError(
      "This matter has no mark on file yet — add the mark text on the matter page before drafting an opinion letter.",
    );
  }

  const { text: extractedText } = await extractTextFromUpload(
    input.upload.bytes,
    input.upload.mime,
    input.upload.fileName,
  );

  // Same resolveMatterClientName the matter detail page uses (contact ->
  // lead -> owner_name), so an opinion letter never addresses a client by a
  // guessed name. clientEmail still comes off the linked lead directly —
  // resolveMatterClientName only resolves a NAME, not contact details.
  const lead = matter.lead_id ? await getLead(matter.lead_id) : null;
  const { name: resolvedClientName } = await resolveMatterClientName(matter);
  const clientName = resolvedClientName?.trim() || "the applicant";
  const facts: OpinionLetterMatterFacts = {
    markText: matter.mark_text,
    markType: input.markType,
    internationalClasses: matter.international_classes,
    goodsServices: matter.goods_services,
    clientName,
    entityName: input.entityName.trim() || null,
    clientEmail: lead?.email ?? null,
    honorific: input.honorific.trim(),
    letterDate: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };

  const built = await buildOpinionLetterDraft(facts, extractedText);

  return queueBuiltDraft({
    matterId: matter.id,
    orgId: matter.org_id,
    docType: "opinion_letter",
    agent: "document-center",
    headline: built.headline,
    summary: built.summary,
    draftBody: built.draftBody,
    clientName,
    payload: { clientName, entityName: facts.entityName, markText: facts.markText },
  });
}

export type TrademarkClearanceFormInput = {
  matterId: string;
  filingBasis: TrademarkClearanceFilingBasis;
  entityName: string;
  /** Staff-typed preliminary TESS/web search findings — the ONLY source for
   * every cited mark. Free text, not an upload: unlike opinion-letter, there
   * is no TMTKO report at this pre-engagement stage. */
  searchFindings: string;
};

/** Runs the trademark-clearance SOP against the matter's on-file facts and
 * staff-entered preliminary search findings, then queues the draft. No
 * upload/extraction step — see trademark-clearance.ts's header comment for
 * why this flow differs from generateOpinionLetter's. */
export async function generateTrademarkClearance(
  input: TrademarkClearanceFormInput,
): Promise<{ draftId: string; queueItemId: string }> {
  const supabase = await getScopedClient();
  await requireDocumentWriteRole(supabase);

  const matter = await getMatter(input.matterId);
  if (!matter) throw new DocumentFlowError("Matter not found.");
  if (!matter.mark_text) {
    throw new DocumentFlowError(
      "This matter has no mark on file yet — add the mark text on the matter page before drafting a clearance opinion.",
    );
  }
  if (!input.searchFindings.trim()) {
    throw new DocumentFlowError(
      "Paste in the preliminary search findings before generating — this draft never invents a search result.",
    );
  }

  // Same client-name resolution as generateOpinionLetter.
  const lead = matter.lead_id ? await getLead(matter.lead_id) : null;
  const { name: resolvedClientName } = await resolveMatterClientName(matter);
  const clientName = resolvedClientName?.trim() || "the applicant";
  const facts: TrademarkClearanceMatterFacts = {
    markText: matter.mark_text,
    filingBasis: input.filingBasis,
    internationalClasses: matter.international_classes,
    goodsServices: matter.goods_services,
    clientName,
    entityName: input.entityName.trim() || null,
    clientEmail: lead?.email ?? null,
    searchDate: new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  };

  const built = await buildTrademarkClearanceDraft(facts, input.searchFindings);

  return queueBuiltDraft({
    matterId: matter.id,
    orgId: matter.org_id,
    docType: "trademark_clearance",
    agent: "document-center",
    headline: built.headline,
    summary: built.summary,
    draftBody: built.draftBody,
    clientName,
    payload: { clientName, entityName: facts.entityName, markText: facts.markText },
  });
}

export type TrademarkLoeFormInput = TrademarkLoeInput & { matterId: string };

export async function generateTrademarkLoe(
  input: TrademarkLoeFormInput,
): Promise<{ draftId: string; queueItemId: string }> {
  const supabase = await getScopedClient();
  await requireDocumentWriteRole(supabase);

  const matter = await getMatter(input.matterId);
  if (!matter) throw new DocumentFlowError("Matter not found.");

  const built = buildTrademarkLoeDraft(input);

  return queueBuiltDraft({
    matterId: matter.id,
    orgId: matter.org_id,
    docType: built.docType,
    agent: "document-center",
    headline: built.headline,
    summary: built.summary,
    draftBody: built.draftBody,
    clientName: input.entityName?.trim() || input.clientName,
    payload: built.payload,
  });
}

export type GeneralLoeFormInput = GeneralLoeInput & { matterId: string };

export async function generateGeneralLoe(
  input: GeneralLoeFormInput,
): Promise<{ draftId: string; queueItemId: string }> {
  const supabase = await getScopedClient();
  await requireDocumentWriteRole(supabase);

  const matter = await getMatter(input.matterId);
  if (!matter) throw new DocumentFlowError("Matter not found.");

  const built = await buildGeneralLoeDraft(input);

  return queueBuiltDraft({
    matterId: matter.id,
    orgId: matter.org_id,
    docType: built.docType,
    agent: "document-center",
    headline: built.headline,
    summary: built.summary,
    draftBody: built.draftBody,
    clientName: input.entityName?.trim() || input.clientName,
    payload: built.payload,
  });
}
