import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getMatter, requireMatterWriteRole } from "@/lib/matters/matters";
import { getLead } from "@/lib/pipeline/leads";
import { logActivity, hasMatterActivityType } from "@/lib/matters/activity";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { createDraft } from "@/lib/queue/api";
import { WelcomeFlowError } from "./errors";
import { buildWelcomeEmailDraft } from "./welcome-email";

/**
 * `welcome-client` skill trigger — same "build content, then queue it"
 * plumbing as src/lib/documents/generate.ts's queueBuiltDraft, but with no
 * local bookkeeping table (see 0046's migration comment for why): the
 * crm_activity 'welcome_email' row IS the record, written only after the
 * queue POST succeeds so a failed queue call never leaves a false "already
 * sent" gate behind.
 *
 * Scoped to trademark matters only, per the SOP ("the trademark
 * questionnaire") and this task's brief — a non-TM matter refuses rather
 * than silently drafting a trademark-specific email for e.g. a copyright
 * matter.
 *
 * The queue type is CLIENT_EMAIL (src/app/(firm)/dashboard/queue/_components/
 * Chips.tsx is the one other place in this app that already renders that
 * exact string, confirming the vocabulary rather than guessing it).
 */
const QUEUE_TYPE_CLIENT_EMAIL = "CLIENT_EMAIL";

export type GenerateWelcomeEmailInput = {
  matterId: string;
};

export async function generateWelcomeEmail(
  input: GenerateWelcomeEmailInput,
): Promise<{ queueItemId: string }> {
  const supabase = await getScopedClient();
  await requireMatterWriteRole(supabase);

  const matter = await getMatter(input.matterId);
  if (!matter) throw new WelcomeFlowError("Matter not found.");
  if (matter.type !== "TM") {
    throw new WelcomeFlowError(
      "The welcome-email action is scoped to trademark matters — this matter isn't one.",
    );
  }

  // The idempotency gate: one welcome email per matter, ever. Checked here
  // (not just hidden in the UI) so a stale page or a second tab can't queue
  // a duplicate.
  if (await hasMatterActivityType(matter.id, "welcome_email")) {
    throw new WelcomeFlowError("A welcome email has already been queued for this matter.");
  }

  const orgKey = await activeQueueOrgKey();
  if (!orgKey) {
    throw new WelcomeFlowError(
      "Approvals aren't enabled for this firm yet — ask an admin to set up the approval queue before drafting the welcome email.",
    );
  }

  // Same client-name resolution as the Document Center flows
  // (src/lib/documents/generate.ts) — a linked crm_lead first, then the
  // tracker's owner_name, so the email never addresses a client by a
  // guessed name.
  const lead = matter.lead_id ? await getLead(matter.lead_id) : null;
  const clientOrEntityName =
    (lead ? lead.business_name?.trim() || `${lead.first_name} ${lead.last_name}`.trim() : null) ||
    matter.owner_name?.trim() ||
    "the client";

  const built = buildWelcomeEmailDraft({
    clientOrEntityName,
    markText: matter.mark_text,
    matterNumber: matter.matter_number,
    clientEmail: lead?.email ?? null,
    sendDateIso: new Date().toISOString().slice(0, 10),
  });

  const { id: queueItemId } = await createDraft({
    orgKey,
    agent: "welcome-client",
    type: QUEUE_TYPE_CLIENT_EMAIL,
    headline: built.headline,
    draftBody: built.draftBody,
    summary: built.summary,
    matterId: matter.id,
    clientName: clientOrEntityName,
  });

  // Written only now — after the queue POST has already succeeded — so a
  // failed createDraft call never leaves a false "already sent" gate that
  // silently blocks the retry.
  await logActivity({
    type: "welcome_email",
    matterId: matter.id,
    payload: {
      queueItemId,
      clientName: clientOrEntityName,
      recipient: built.recipient,
      subject: built.subject,
    },
  });

  return { queueItemId };
}
