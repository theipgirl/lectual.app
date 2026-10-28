import type { ActionState } from "@/app/dashboard/proposals/errors";

/**
 * "Draft email to client": once a proposal's link is live, put a CLIENT_EMAIL draft that carries
 * the link into the approval queue. It only queues text for review through the same queue path
 * every other draft uses; nothing here sends, and no mailbox is read (spec D2). The queue's three
 * states apply: an unconfigured or unreachable queue creates nothing and says why, never "queued".
 *
 * Dependencies are passed in so the order, the dedupe and every refusal are tested without a
 * queue or a database.
 */

export const DRAFT_EMAIL_SENTENCES = {
  notLive: "Create the client link first. There is nothing to put in an email until the link is live.",
  noQueue: "Approvals aren't set up for your firm yet, so this draft can't be queued. Nothing was drafted.",
  queueDown: "The approval queue can't be reached right now, so nothing was drafted. Try again shortly.",
  failed: "The email draft couldn't be queued. Nothing was drafted. Try again shortly.",
  queued: "Email draft queued for review. Nothing was sent.",
  alreadyQueued: "A draft with this link is already waiting in the approval queue. Nothing new was queued.",
  notEmailed: "The client hasn't been emailed by Lectual.",
} as const;

export type DraftEmailProposal = {
  id: string;
  status: string;
  clientName: string;
  firstName: string | null;
  clientEmail: string | null;
  orgId: string;
  publicToken: string;
  matterId: string | null;
  leadId: string | null;
};

export type PendingDraft = { id: string; type: string; draftBody: string };

export type DraftEmailDeps = {
  /** The module gate and staff-role check; a refusal is returned as is. */
  gate: () => Promise<ActionState | null>;
  loadProposal: (id: string) => Promise<DraftEmailProposal | null>;
  /** The firm's display name and email sign-off, for the draft's wording. */
  firm: () => Promise<{ name: string; signOff: string | null }>;
  /** The queue's org key (null = this firm has no queue). */
  orgKey: () => Promise<string | null>;
  /** The pending queue, three-state. */
  pending: () => Promise<{ status: "ok"; items: PendingDraft[] } | { status: "unconfigured" } | { status: "unavailable" }>;
  /** `clientLinkOrigin` + `clientLinkUrl`: the only place the URL is built. */
  linkUrl: (orgId: string, token: string) => Promise<string>;
  createDraft: (input: {
    orgKey: string;
    agent: string;
    type: "CLIENT_EMAIL";
    headline: string;
    draftBody: string;
    summary: string;
    clientName: string;
    recipient?: string;
    subject: string;
    signOff: string | null;
    matterId?: string;
    leadId?: string;
    dedupe: false;
  }) => Promise<{ id: string }>;
  revalidate: (id: string) => void;
};

/** The wording of the draft. Facts and the link only: no advice, no promises, no prices. */
export function buildProposalEmail(input: { firstName: string | null; firmName: string; url: string }): { subject: string; body: string } {
  const greeting = input.firstName?.trim() ? `Hi ${input.firstName.trim()},` : "Hello,";
  return {
    subject: `Your trademark proposal from ${input.firmName}`,
    body: [
      greeting,
      `Thank you for speaking with us. Your proposal from ${input.firmName} is ready. You can review it, choose the marks and classes you'd like us to include, and accept it here:`,
      input.url,
      "If you have questions before you decide, just reply to this email.",
    ].join("\n\n"),
  };
}

export async function runDraftClientEmail(deps: DraftEmailDeps, proposalId: string): Promise<ActionState> {
  const refused = await deps.gate();
  if (refused) return refused;

  let proposal: DraftEmailProposal | null;
  try {
    proposal = await deps.loadProposal(proposalId);
  } catch {
    return { error: DRAFT_EMAIL_SENTENCES.failed };
  }
  if (!proposal) return { error: DRAFT_EMAIL_SENTENCES.failed };
  if (proposal.status !== "sent" && proposal.status !== "accepted") return { error: DRAFT_EMAIL_SENTENCES.notLive };

  const orgKey = await deps.orgKey().catch(() => "error" as const);
  if (orgKey === "error") return { error: DRAFT_EMAIL_SENTENCES.queueDown };
  if (!orgKey) return { error: DRAFT_EMAIL_SENTENCES.noQueue };

  const url = await deps.linkUrl(proposal.orgId, proposal.publicToken);

  // A second click must not queue a second draft: look at what is pending first. If the queue
  // can't be read we can't promise that, so nothing is queued.
  const pending = await deps.pending();
  if (pending.status === "unconfigured") return { error: DRAFT_EMAIL_SENTENCES.noQueue };
  if (pending.status === "unavailable") return { error: DRAFT_EMAIL_SENTENCES.queueDown };
  if (pending.items.some((i) => i.type === "CLIENT_EMAIL" && i.draftBody.includes(url))) {
    return { saved: true, notice: DRAFT_EMAIL_SENTENCES.alreadyQueued };
  }

  const firm = await deps.firm().catch(() => ({ name: "our firm", signOff: null }));
  const email = buildProposalEmail({ firstName: proposal.firstName, firmName: firm.name, url });
  const hasRealAddress = !!proposal.clientEmail && !proposal.clientEmail.toLowerCase().endsWith(".invalid");
  try {
    await deps.createDraft({
      orgKey,
      agent: "post-consult",
      type: "CLIENT_EMAIL",
      headline: `Proposal link — ${proposal.clientName}`.slice(0, 200),
      draftBody: email.body,
      summary: "The client's proposal link is live. This email carries the link; review it before anything is sent.",
      clientName: proposal.clientName,
      ...(hasRealAddress ? { recipient: proposal.clientEmail! } : {}),
      subject: email.subject,
      signOff: firm.signOff,
      ...(proposal.matterId ? { matterId: proposal.matterId } : {}),
      ...(proposal.leadId ? { leadId: proposal.leadId } : {}),
      dedupe: false,
    });
  } catch {
    return { error: DRAFT_EMAIL_SENTENCES.failed };
  }
  deps.revalidate(proposalId);
  return { saved: true, notice: DRAFT_EMAIL_SENTENCES.queued };
}
