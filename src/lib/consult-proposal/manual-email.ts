import type { ProposalContent, ProposalRow } from "@/lib/proposals/types";
import {
  ProposalEmailError,
  buildReasoningBlock,
  offersWordAndLogo,
  proposalEmailSubject,
  renderProposalEmail,
} from "./email";
import { CONSULT_PROPOSAL_SOURCE, firmSignatureName, firmTeamSignOff } from "./shared";

/**
 * "Create post-consult email": queues Rebecca's approved proposal-link email for a
 * proposal that already exists (made by hand), instead of the consult agent
 * creating the proposal AND the email.
 *
 * Nothing here is written by a model and no client-facing sentence is new: the
 * body is `renderProposalEmail` with Rebecca's template, the subject is
 * `proposalEmailSubject`, and the only reasoning paragraph ever chosen is her
 * `principle` one, when the proposal offers a word and a logo mark. The risk and
 * fallback paragraphs need an attorney's reading of a search, so this button
 * never picks them.
 *
 * Pure apart from the injected dependencies (the same shape as
 * `proposal-editor/create-link.ts`), so the order of checks and every refusal is
 * tested without a database or the queue.
 *
 * The queued item is linked to the proposal by the SAME `queue_drafted` timeline
 * marker `link.ts` reads (`payload.source = 'consult-proposal'`, `queue_id`,
 * `proposal_id`), so `gateLinkedProposal` applies unchanged: only a named
 * approver approves it, and only once the proposal is saved or its link is live.
 * Nothing is sent: approving the queue item makes an Outlook draft for a person.
 */

export const MANUAL_EMAIL_LABEL = "Create post-consult email";
/** Shown beside the button (Sprint 33): the link being live is not an email. */
export const NOT_EMAILED = "The client hasn't been emailed by Lectual.";
export const MANUAL_EMAIL_PENDING = "Creating email…";
export const MANUAL_EMAIL_QUEUED = "Post-consult email queued for approval.";

export const MANUAL_EMAIL_REFUSALS = {
  notFound: "Proposal not found.",
  status: "Create the client link first. Only a proposal whose link is live can have its email queued. Nothing was queued.",
  noEmail: "Add the client's email address to this proposal first. Nothing was queued.",
  noRecord:
    "Link this proposal to a lead or matter first, so the email can be tied to it for approval. Nothing was queued.",
  noQueue: "No approval queue is connected for your firm, so nothing was queued.",
  noFirmName: "Your firm has no name set (Settings, then Firm), so the email can't be signed. Nothing was queued.",
  noOrigin: "The site address isn't known here, so the proposal link couldn't be built. Nothing was queued.",
  pending: "A post-consult email for this proposal is already waiting in the approval queue. Review or reject it first.",
  pendingUnreadable: "Couldn't check the approval queue for an earlier email. Nothing was queued. Try again shortly.",
  queueFailed: "The approval queue couldn't be reached. Nothing was queued. Try again shortly.",
  linkPending: "An email with this proposal's link is already waiting in the approval queue. Nothing new was queued.",
  deduped: "A proposal email for this client is already waiting in the approval queue. Review or reject that one first.",
  unlinked:
    "The email was queued but couldn't be linked to this proposal. Reject it in the approval queue now: it must not be approved. Then try again.",
  unexpected: "The email couldn't be queued. Nothing was sent. Try again shortly.",
} as const;

/**
 * Statuses whose client link is LIVE (Sprint 33: nothing to put in an email until it is). A draft or a
 * saved-not-live version is refused; the consult agent's own email for those keeps its approve gate in link.ts.
 */
const QUEUEABLE: ReadonlySet<ProposalRow["status"]> = new Set(["sent", "accepted"]);

/** The reasoning block this button may use: Rebecca's `principle` paragraph and nothing chosen by guesswork. */
export function manualReasoning(content: Pick<ProposalContent, "names">): string | null {
  return buildReasoningBlock({ principle: offersWordAndLogo(content), riskBrand: null, fallbackBrand: null });
}

/** A usable recipient: present and not the placeholder used for "no real address". */
export function usableRecipient(email: string | null | undefined): string | null {
  const v = (email ?? "").trim();
  if (!v || v.toLowerCase().endsWith(".invalid")) return null;
  return v;
}

/** The email, rendered from the proposal alone. Throws `ProposalEmailError` for an unusable link or sign-off. */
export function buildManualEmail(args: {
  content: Pick<ProposalContent, "client" | "names" | "pricing">;
  firmName: string;
  proposalUrl: string;
  signOff: string;
}): { subject: string; body: string } {
  return renderProposalEmail(
    { content: args.content, email: { subject: proposalEmailSubject(args.firmName), reasoning: manualReasoning(args.content) } },
    { proposalUrl: args.proposalUrl, signOff: args.signOff },
  );
}

/** The timeline row `link.ts` finds the proposal by. Same shape `run.ts` writes. */
export function manualMarker(args: {
  orgId: string;
  userId: string | null;
  leadId: string | null;
  matterId: string | null;
  proposalId: string;
  queueId: string;
  subject: string;
}) {
  return {
    org_id: args.orgId,
    lead_id: args.leadId,
    matter_id: args.matterId,
    type: "queue_drafted" as const,
    actor_id: args.userId,
    actor_type: "user" as const,
    payload: {
      source: CONSULT_PROPOSAL_SOURCE,
      proposal_id: args.proposalId,
      queue_id: args.queueId,
      subject: args.subject,
      created_from: "proposal-page",
    },
  };
}

export type PendingRead = { status: "none" } | { status: "pending"; queueId: string } | { status: "unreadable" };

/** The pending approval queue, three-state: a failed read is never "nothing pending". */
export type PendingQueueRead =
  | { status: "ok"; items: Array<{ type: string; draftBody: string }> }
  | { status: "unconfigured" }
  | { status: "unavailable" };

export type ManualEmailDraftInput = {
  orgKey: string;
  agent: string;
  type: "CLIENT_EMAIL";
  headline: string;
  summary: string;
  clientName: string;
  leadId?: string;
  matterId?: string;
  recipient: string;
  subject: string;
  draftBody: string;
  teamSignOff: string;
  dedupe: false;
};

export type ManualEmailDeps = {
  /** Session, staff role, `proposals` module (notFound when off). A refusal is returned as is. */
  gate: () => Promise<{ error?: string } | null>;
  /** The proposal, read through the caller's scoped client. Null = not found (or another firm's). Throws = unreadable. */
  loadProposal: (id: string) => Promise<ProposalRow | null>;
  /** The firm and the person, from the session. Null = no usable session. */
  context: () => Promise<{ orgId: string; userId: string; firmName: string; firmSlug: string } | null>;
  queueOrgKey: () => Promise<string | null>;
  /** The client link (firm's own domain when configured) and the staff link. Throws when no origin is known. */
  links: (orgId: string, publicToken: string, proposalId: string) => Promise<{ clientUrl: string; staffUrl: string }>;
  /** Is an email for this proposal already pending in the queue? */
  pendingFor: (proposalId: string) => Promise<PendingRead>;
  /** The whole pending queue, so an email carrying the same client link (any version, any source) is not queued twice. */
  pendingQueue: () => Promise<PendingQueueRead>;
  createDraft: (input: ManualEmailDraftInput) => Promise<{ id: string; deduped?: boolean }>;
  writeMarker: (row: ReturnType<typeof manualMarker>) => Promise<boolean>;
  revalidate: (proposalId: string, leadId: string | null) => void;
  /** "[TEST] " unless production. */
  testPrefix: string;
};

export type ManualEmailResult = { ok: true; notice: string; queueId: string } | { ok: false; error: string };

const fail = (error: string): ManualEmailResult => ({ ok: false, error });

export async function runManualEmail(deps: ManualEmailDeps, proposalId: string): Promise<ManualEmailResult> {
  const refused = await deps.gate();
  if (refused) return fail(refused.error ?? MANUAL_EMAIL_REFUSALS.unexpected);
  try {
    return await run(deps, proposalId);
  } catch {
    // Nothing about the failure (it may name a client or a key) reaches the person.
    return fail(MANUAL_EMAIL_REFUSALS.unexpected);
  }
}

async function run(deps: ManualEmailDeps, proposalId: string): Promise<ManualEmailResult> {
  const ctx = await deps.context();
  if (!ctx) return fail(MANUAL_EMAIL_REFUSALS.notFound);

  let proposal: ProposalRow | null;
  try {
    proposal = await deps.loadProposal(proposalId);
  } catch {
    return fail(MANUAL_EMAIL_REFUSALS.unexpected);
  }
  if (!proposal || proposal.org_id !== ctx.orgId) return fail(MANUAL_EMAIL_REFUSALS.notFound);
  if (!QUEUEABLE.has(proposal.status)) return fail(MANUAL_EMAIL_REFUSALS.status);

  const recipient = usableRecipient(proposal.client_email);
  if (!recipient) return fail(MANUAL_EMAIL_REFUSALS.noEmail);
  // The approve gate reads a timeline marker, and a timeline row needs a lead or a matter
  // (crm_activity_target). Without one the email would sit in the queue ungated: refuse first.
  if (!proposal.lead_id && !proposal.matter_id) return fail(MANUAL_EMAIL_REFUSALS.noRecord);

  let orgKey: string | null;
  try {
    orgKey = await deps.queueOrgKey();
  } catch {
    return fail(MANUAL_EMAIL_REFUSALS.queueFailed);
  }
  if (!orgKey) return fail(MANUAL_EMAIL_REFUSALS.noQueue);

  const signOff = firmTeamSignOff(ctx.firmName, ctx.firmSlug);
  if (!signOff) return fail(MANUAL_EMAIL_REFUSALS.noFirmName);
  const firmName = firmSignatureName(ctx.firmName, ctx.firmSlug) as string;

  const pending = await deps.pendingFor(proposal.id);
  if (pending.status === "pending") return fail(MANUAL_EMAIL_REFUSALS.pending);
  if (pending.status === "unreadable") return fail(MANUAL_EMAIL_REFUSALS.pendingUnreadable);

  let email: { subject: string; body: string };
  let staffUrl: string;
  try {
    const urls = await deps.links(ctx.orgId, proposal.public_token, proposal.id);
    staffUrl = urls.staffUrl;
    email = buildManualEmail({ content: proposal.content, firmName, proposalUrl: urls.clientUrl, signOff });
  } catch (err) {
    // ProposalEmailError messages are fixed sentences about the link or sign-off; anything else is not shown.
    return fail(err instanceof ProposalEmailError ? `${err.message} Nothing was queued.` : MANUAL_EMAIL_REFUSALS.noOrigin);
  }

  // A second click, or an email the consult agent already queued with this link (the token is shared by every
  // version), must not queue another. If the queue can't be read we can't promise that, so nothing is queued.
  let queue: PendingQueueRead;
  try {
    queue = await deps.pendingQueue();
  } catch {
    queue = { status: "unavailable" };
  }
  if (queue.status === "unconfigured") return fail(MANUAL_EMAIL_REFUSALS.noQueue);
  if (queue.status === "unavailable") return fail(MANUAL_EMAIL_REFUSALS.pendingUnreadable);
  // A substring to look for, not a URL (URLs are built only by clientLinkUrl).
  const linkFragment = "/p/" + proposal.public_token;
  if (queue.items.some((i) => i.type === "CLIENT_EMAIL" && typeof i.draftBody === "string" && i.draftBody.includes(linkFragment))) {
    return fail(MANUAL_EMAIL_REFUSALS.linkPending);
  }

  let queueId: string;
  try {
    const queued = await deps.createDraft({
      orgKey,
      agent: "post-consult",
      type: "CLIENT_EMAIL",
      headline: `${deps.testPrefix}Proposal + follow-up — ${proposal.client_name}`.slice(0, 200),
      summary: `Proposal (review, edit, approve): ${staffUrl}`,
      clientName: proposal.client_name,
      ...(proposal.lead_id ? { leadId: proposal.lead_id } : {}),
      ...(proposal.matter_id ? { matterId: proposal.matter_id } : {}),
      recipient,
      subject: `${deps.testPrefix}${email.subject}`,
      draftBody: email.body,
      teamSignOff: signOff,
      // The marker ties this proposal to the returned id and the approve gate trusts it: it must be our own item.
      dedupe: false,
    });
    if (queued.deduped) return fail(MANUAL_EMAIL_REFUSALS.deduped);
    queueId = queued.id;
  } catch {
    return fail(MANUAL_EMAIL_REFUSALS.queueFailed);
  }

  const row = manualMarker({
    orgId: ctx.orgId,
    userId: ctx.userId,
    leadId: proposal.lead_id,
    matterId: proposal.matter_id,
    proposalId: proposal.id,
    queueId,
    subject: email.subject,
  });
  let written = false;
  for (let attempt = 0; attempt < 2 && !written; attempt += 1) {
    try {
      written = await deps.writeMarker(row);
    } catch {
      written = false;
    }
  }
  // Without the marker the approve gate cannot find this proposal, so the email must not be approved. Rejecting it
  // is a queue resolve, which this repo keeps in one place (the queue actions), so the person is told to do it.
  if (!written) return fail(MANUAL_EMAIL_REFUSALS.unlinked);

  deps.revalidate(proposal.id, proposal.lead_id);
  return { ok: true, notice: MANUAL_EMAIL_QUEUED, queueId };
}
