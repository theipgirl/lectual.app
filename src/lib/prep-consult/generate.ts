import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getLead, resolveCurrentRole, CAN_WRITE_LEAD } from "@/lib/pipeline";
import { logActivitySafe } from "@/lib/matters/activity";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { createDraft } from "@/lib/queue/api";
import { PrepConsultFlowError } from "./errors";
import type { PrepConsultFacts } from "./prep-consult";
import { buildHeadsUpDraft, buildClientPrepDraft } from "./drafts";

/**
 * `prep-consult` skill trigger — staff-invoked from the lead detail page,
 * NOT auto-detected from a Lawmatics event (this app has no reachable
 * Lawmatics event/intake integration from a lead record; see prep-consult.ts's
 * header comment). Produces the SOP's two booking-triggered drafts and queues
 * both to the SAME approval queue every other skill trigger in this app
 * writes to:
 *
 *   - HEADS-UP    -> type = BRIEFING     (internal to Rebecca, no recipient)
 *   - CLIENT-PREP -> type = CLIENT_EMAIL (the client, via the approval queue)
 *
 * matching the SOP's own § HEADS-UP / § CLIENT-PREP EMAIL type assignment.
 * Nothing here sends anything — approving a CLIENT_EMAIL draft in the queue
 * authorizes the send, it does not execute one (lawmatics-mcp's
 * resolveQueueItem, AGENTS.md's "three states, never two" section).
 *
 * Both drafts are built (and judgment-boundary-checked — see
 * assertNoJudgmentContent) before either is queued, so a failure while
 * building the second draft never leaves an orphaned client-facing queue
 * item with no matching internal heads-up. If the SECOND createDraft call
 * fails after the first has already succeeded, that first draft is not
 * rolled back (queue POSTs are final everywhere else in this app too — see
 * filing-followup-action.ts) — the caller sees the error and can re-run,
 * and any duplicate heads-up is harmless internal noise, never a duplicate
 * client send.
 */

const QUEUE_TYPE_HEADS_UP = "BRIEFING";
const QUEUE_TYPE_CLIENT_PREP = "CLIENT_EMAIL";

async function requirePrepConsultWriteRole(): Promise<void> {
  const supabase = await getScopedClient();
  const role = await resolveCurrentRole(supabase);
  if (!CAN_WRITE_LEAD.includes(role)) {
    throw new PrepConsultFlowError("You don't have permission to draft consult prep emails.");
  }
}

export type PrepConsultFormInput = {
  leadId: string;
  practiceArea: string;
  inquiryDescription: string;
  /** Raw staff-typed strings — "" means "not yet known," never coerced into
   * a guessed value. See prep-consult.ts's PrepConsultFacts for why these
   * stay free text. */
  sessionWhen: string;
  zoomLink: string;
};

export type PrepConsultResult = {
  headsUpQueueItemId: string;
  clientPrepQueueItemId: string;
};

export async function queuePrepConsultDrafts(input: PrepConsultFormInput): Promise<PrepConsultResult> {
  await requirePrepConsultWriteRole();

  const practiceArea = input.practiceArea.trim();
  if (!practiceArea) {
    throw new PrepConsultFlowError("Choose a practice area before drafting the consult prep.");
  }

  const inquiryDescription = input.inquiryDescription.trim();
  if (!inquiryDescription) {
    throw new PrepConsultFlowError(
      "Describe the client's inquiry before drafting the consult prep — this flow never invents what the client is asking for.",
    );
  }

  const lead = await getLead(input.leadId);
  if (!lead) throw new PrepConsultFlowError("Lead not found.");

  const orgKey = await activeQueueOrgKey();
  if (!orgKey) {
    throw new PrepConsultFlowError(
      "Approvals aren't enabled for this firm yet — ask an admin to set up the approval queue before drafting consult prep emails.",
    );
  }

  const clientName = lead.business_name?.trim() || `${lead.first_name} ${lead.last_name}`.trim();

  const facts: PrepConsultFacts = {
    clientName,
    clientEmail: lead.email,
    practiceArea,
    inquiryDescription,
    sessionWhen: input.sessionWhen.trim() || null,
    zoomLink: input.zoomLink.trim() || null,
  };

  // Both drafts are built before either is queued — see header comment.
  const headsUp = await buildHeadsUpDraft(facts);
  const clientPrep = await buildClientPrepDraft(facts);

  const { id: headsUpQueueItemId } = await createDraft({
    orgKey,
    agent: "prep-consult",
    type: QUEUE_TYPE_HEADS_UP,
    headline: headsUp.headline,
    draftBody: headsUp.draftBody,
    summary: headsUp.summary,
    clientName,
    // Internal to Rebecca — deliberately no recipient/subject; those are
    // meaningful only for the client-facing draft below.
  });
  await logActivitySafe({
    type: "queue_drafted",
    leadId: lead.id,
    payload: { agent: "prep-consult", kind: "heads_up", queueItemId: headsUpQueueItemId },
  });

  const { id: clientPrepQueueItemId } = await createDraft({
    orgKey,
    agent: "prep-consult",
    type: QUEUE_TYPE_CLIENT_PREP,
    headline: clientPrep.headline,
    draftBody: clientPrep.draftBody,
    summary: clientPrep.summary,
    clientName,
    recipient: lead.email,
    subject: clientPrep.subject,
  });
  await logActivitySafe({
    type: "queue_drafted",
    leadId: lead.id,
    payload: {
      agent: "prep-consult",
      kind: "client_prep",
      queueItemId: clientPrepQueueItemId,
      recipient: lead.email,
    },
  });

  return { headsUpQueueItemId, clientPrepQueueItemId };
}
