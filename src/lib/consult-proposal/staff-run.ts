import "server-only";
import { revalidatePath } from "next/cache";
import { aiConfigured, callClaude } from "@/lib/ai/claude";
import { getAdminClient } from "@/lib/db/admin";
import { getScopedClient } from "@/lib/db/scoped-client";
import { createDraft } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { getSiteOrigin } from "@/lib/site-origin";
import { runConsultProposal } from "./run";
import type { ConsultLead, ConsultSource } from "./types";

/**
 * The button paths' shared tail: gates that are about the deployment (queue,
 * model, site address), then `runConsultProposal` with the CALLER's own scoped
 * client as `db` (so RLS also fences it) and the admin client only for the
 * evidence event. The caller (a server action) has already checked the session,
 * the staff role and the `proposals` module.
 */

export type StaffDraftResult = { ok: true; notice: string; href: string } | { ok: false; error: string };

export async function draftProposalForStaff(args: {
  orgId: string;
  userId: string;
  source: ConsultSource;
  lead: ConsultLead;
  matterId: string | null;
}): Promise<StaffDraftResult> {
  const orgKey = await activeQueueOrgKey();
  if (!orgKey) return { ok: false, error: "No approval queue is connected for your firm, so nothing was drafted." };
  if (!aiConfigured()) return { ok: false, error: "Drafting isn't set up on this deployment yet." };

  let result: Awaited<ReturnType<typeof runConsultProposal>>;
  try {
    result = await runConsultProposal({
      db: await getScopedClient(),
      admin: getAdminClient(),
      orgId: args.orgId,
      actorUserId: args.userId,
      source: args.source,
      lead: args.lead,
      matterId: args.matterId,
      llm: callClaude,
      createDraft,
      queueOrgKey: orgKey,
      origin: await getSiteOrigin(),
    });
  } catch {
    return { ok: false, error: "The proposal couldn't be drafted. Nothing was sent. Try again shortly." };
  }
  if (!result.ok) return { ok: false, error: result.message };

  revalidatePath("/dashboard/proposals/");
  revalidatePath("/dashboard/queue/");
  revalidatePath(`/dashboard/leads/${args.lead.id}/`);
  const checks =
    result.errorCount > 0
      ? ` It has ${result.errorCount} thing${result.errorCount === 1 ? "" : "s"} to fix before it can be approved.`
      : result.warningCount > 0
        ? ` ${result.warningCount} thing${result.warningCount === 1 ? "" : "s"} to check.`
        : "";
  return {
    ok: true,
    href: `/dashboard/proposals/${result.proposalId}/`,
    notice: `Drafted a proposal and its email.${checks} Nothing is visible to the client or sent: a named approver approves the proposal, then the email in the approval queue.`,
  };
}
