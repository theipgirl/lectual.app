import "server-only";
import { getMatter, requireMatterWriteRole as requireMatterWriteRoleWithClient } from "./matters";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getLead } from "@/lib/pipeline/leads";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { createDraft } from "@/lib/queue/api";
import { DocumentFlowError } from "@/lib/documents/errors";
import {
  AWAITING_REGISTRATION_STAGE_CODE,
  computeFollowUpStatus,
  buildMonthlyStatusUpdateDraft,
} from "./filing-followup";
import { loadFollowUpQueueState, queuedMonthsLookupFor } from "./filing-followup-queue";

/**
 * Drafts the next monthly status-update email for one matter and queues it —
 * same "build content, then queue it" shape as
 * src/lib/documents/generate.ts's queueBuiltDraft, minus the
 * crm_document_draft bookkeeping row: that table exists to track real .docx
 * files a post-approval hook generates (src/lib/documents/approve-hook.ts),
 * and a CLIENT_EMAIL draft never goes through that hook (see
 * DOCUMENT_QUEUE_TYPES in src/lib/documents/types.ts) — there is nothing for
 * a bookkeeping row to track here. The approval queue itself (reached
 * through createDraft) is the only state this feature needs, and
 * filing-followup-queue.ts already reads it back out for the due-ness check.
 */
export async function queueMonthlyStatusUpdate(matterId: string): Promise<{ queueItemId: string }> {
  const supabase = await getScopedClient();
  await requireMatterWriteRoleWithClient(supabase);

  const matter = await getMatter(matterId);
  if (!matter) throw new DocumentFlowError("Matter not found.");
  if (matter.stage?.code !== AWAITING_REGISTRATION_STAGE_CODE) {
    throw new DocumentFlowError(
      "This matter isn't in the Awaiting Trademark Registration stage — filing follow-ups only run there.",
    );
  }
  if (!matter.mark_text) {
    throw new DocumentFlowError("This matter has no mark on file yet — add the mark text first.");
  }

  const lead = matter.lead_id ? await getLead(matter.lead_id) : null;
  const clientFirstName = lead?.first_name?.trim();
  if (!clientFirstName) {
    throw new DocumentFlowError(
      "This matter's client has no first name on file — add one before drafting a status update.",
    );
  }
  const recipient = lead?.email?.trim() || null;
  if (!recipient) {
    throw new DocumentFlowError(
      "This matter's client has no email on file — add one before drafting a status update.",
    );
  }

  // Re-checks due-ness against the queue at the moment of the click, not just
  // whatever the page rendered a request ago — the real guard against a
  // double-queue race (two staff members clicking the same button, or one
  // clicking twice) is here, not in the UI's disabled state.
  const queueState = await loadFollowUpQueueState();
  if (queueState.status === "unconfigured" && queueState.reason === "org-key") {
    throw new DocumentFlowError(
      "Approvals aren't enabled for this firm yet — ask an admin to set up the approval queue before drafting status updates.",
    );
  }
  if (queueState.status !== "ok") {
    throw new DocumentFlowError(
      "Can't draft a status update right now — the approval queue couldn't be reached to confirm nothing is already queued.",
    );
  }
  const monthsAlreadyQueued = queuedMonthsLookupFor(queueState)?.get(matter.id) ?? [];
  const status = computeFollowUpStatus({ filingDate: matter.filing_date, monthsAlreadyQueued }, new Date());
  if (status.kind !== "due") {
    const reason =
      status.kind === "already_queued"
        ? "the next update is already queued or approved"
        : status.kind === "stale"
          ? "this matter looks past the ~5-month sequence — verify its stage before drafting"
          : status.kind === "no_filing_date"
            ? "this matter has no filing date on file"
            : "no update is due yet";
    throw new DocumentFlowError(`Can't draft a status update right now — ${reason}.`);
  }

  const built = buildMonthlyStatusUpdateDraft({
    clientFirstName,
    markText: matter.mark_text,
    monthNumber: status.monthNumber,
    monthsRemainingEstimate: status.monthsRemainingEstimate,
  });

  const orgKey = await activeQueueOrgKey();
  if (!orgKey) {
    throw new DocumentFlowError(
      "Approvals aren't enabled for this firm yet — ask an admin to set up the approval queue before drafting status updates.",
    );
  }

  const clientName =
    lead?.business_name?.trim() || `${lead?.first_name ?? ""} ${lead?.last_name ?? ""}`.trim() || clientFirstName;

  const { id: queueItemId } = await createDraft({
    orgKey,
    agent: "filing-followup",
    type: "CLIENT_EMAIL",
    headline: built.headline,
    draftBody: built.draftBody,
    summary: built.summary,
    matterId: matter.id,
    clientName,
    recipient,
    subject: built.subject,
    proposedSendAt: nextBusinessDay8amEt(new Date()),
  });

  return { queueItemId };
}

/**
 * "Today (or next business day) 08:00 firm-local" per
 * crew/monthly-status-sweep.md's queue_draft call — informational only
 * (nothing here ever sends on a schedule; a human approves and sends
 * manually). Approximated as 12:00 UTC, which is 8am Eastern for most of the
 * year (7am during standard time) — close enough for a proposed time
 * displayed to a human, not treated as a real send trigger anywhere.
 */
function nextBusinessDay8amEt(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // Sun=0..Sat=6
  let addDays = 1;
  const resultDay = (day + addDays) % 7;
  if (resultDay === 0) addDays += 1; // land on Sunday -> push to Monday
  else if (resultDay === 6) addDays += 2; // land on Saturday -> push to Monday
  d.setUTCDate(d.getUTCDate() + addDays);
  d.setUTCHours(12, 0, 0, 0);
  return d.toISOString();
}
