import "server-only";
import { getScopedClient } from "@/lib/db/scoped-client";
import { getQueueItem } from "@/lib/queue/api";
import { activeQueueOrgKey } from "@/lib/queue/org";
import { isCurrentUserApprover, offerTotals, proposalsDb, sendProposal } from "@/lib/proposals/store";
import { ProposalError } from "@/lib/proposals/errors";
import { buildProposalCard, type ProposalCard } from "@/lib/proposals/card";
import type { ProposalContent, ProposalEventRow, ProposalStatus } from "@/lib/proposals/types";
import { validateContent } from "@/lib/proposals/validate";
import { CONSULT_PROPOSAL_SOURCE } from "./shared";

/**
 * The link between an approval-queue item and the proposal the consult agent
 * drafted with it.
 *
 * The queue is another service and its rows carry no metadata, so the link
 * lives where the other drafters keep theirs: a `queue_drafted` timeline row on
 * the lead whose payload names the queue item (`queue_id`) and the proposal
 * (`proposal_id`). Every read here is through the caller's own scoped client,
 * so a marker or proposal from another firm cannot be seen.
 *
 * ── THE APPROVE GATE ────────────────────────────────────────────────────────
 * An email that carries a proposal link may be approved only by one of the
 * firm's named proposal approvers, and only once the proposal itself is
 * approved (or already sent). It fails CLOSED: if the marker cannot be read,
 * the item cannot be approved, because the gate would otherwise be skipped by
 * a database blip. `gateLinkedProposal` is called by `reviewQueueAction`
 * (a server action re-checks everything; the panel on the page is a courtesy).
 */

export { CONSULT_PROPOSAL_SOURCE };

/** Queue ids are the queue service's own; only this shape is ever put in a filter string. */
const QUEUE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ProposalMarker = { proposalId: string; leadId: string | null };
export type MarkerRead = { status: "none" } | { status: "found"; marker: ProposalMarker } | { status: "failed" };

export const APPROVE_PROPOSAL_FIRST = "Approve the proposal first: open it, review it, and click Approve.";

/** The consult-proposal marker for one queue item, or none (an ordinary draft). */
export async function findProposalMarker(queueId: string): Promise<MarkerRead> {
  if (!QUEUE_ID.test(queueId)) return { status: "none" };
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_activity")
      .select("lead_id, payload")
      .eq("type", "queue_drafted")
      .eq("payload->>source", CONSULT_PROPOSAL_SOURCE)
      .eq("payload->>queue_id", queueId)
      .limit(1);
    if (error) return { status: "failed" };
    const row = (data ?? [])[0] as { lead_id?: string | null; payload?: Record<string, unknown> | null } | undefined;
    if (!row) return { status: "none" };
    const proposalId = row.payload?.proposal_id;
    // A marker that names no readable proposal is a broken link, not "no link":
    // fail closed rather than let the email out without its gate.
    if (typeof proposalId !== "string" || !UUID.test(proposalId)) return { status: "failed" };
    return { status: "found", marker: { proposalId, leadId: row.lead_id ?? null } };
  } catch {
    return { status: "failed" };
  }
}

export type LinkedProposalSummary = {
  id: string;
  version: number;
  status: ProposalStatus;
  clientName: string;
  legalCents: number;
  govCents: number;
  /** Rule breaks that block approval. */
  errorCount: number;
  warningCount: number;
  /**
   * The proposal card (queue item page only). Its receipts say "couldn't be
   * loaded" when the events could not be read, never "none". Absent when the
   * caller didn't ask for it (the approve gate).
   */
  card?: ProposalCard;
};

type ProposalRead = { status: "ok"; proposal: LinkedProposalSummary } | { status: "missing" } | { status: "failed" };

const EVENT_COLUMNS = "id, org_id, proposal_id, family_id, type, actor, actor_user_id, payload, created_at";

/** The consult agent's evidence event for one proposal, or null when it could not be read. */
async function readConsultEvents(proposalId: string): Promise<ProposalEventRow[] | null> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await proposalsDb(supabase)
      .from("client_proposal_event")
      .select(EVENT_COLUMNS)
      .eq("proposal_id", proposalId)
      .eq("type", "edited")
      .eq("actor", "agent")
      .order("created_at", { ascending: false })
      .limit(5);
    if (error || !Array.isArray(data)) return null;
    return data as ProposalEventRow[];
  } catch {
    return null;
  }
}

/** The linked proposal as the queue panel and the gate see it. `withCard` also reads the events the card's receipts need. */
export async function readLinkedProposal(proposalId: string, opts: { withCard?: boolean } = {}): Promise<ProposalRead> {
  try {
    const supabase = await getScopedClient();
    const { data, error } = await proposalsDb(supabase)
      .from("client_proposal")
      .select("id, version, status, client_name, client_email, title, content, expires_on, pay_url")
      .eq("id", proposalId)
      .maybeSingle();
    if (error) return { status: "failed" };
    if (!data) return { status: "missing" };
    const row = data as {
      id: string;
      version: number;
      status: ProposalStatus;
      client_name: string;
      client_email: string | null;
      title: string;
      content: ProposalContent;
      expires_on: string | null;
      pay_url: string | null;
    };
    const issues = validateContent(row.content, {
      forApproval: true,
      title: row.title,
      expires_on: row.expires_on,
      pay_url: row.pay_url,
      client_email: row.client_email,
    });
    const totals = offerTotals(row.content);
    const card = opts.withCard ? buildProposalCard(row, await readConsultEvents(row.id)) : undefined;
    return {
      status: "ok",
      proposal: {
        id: row.id,
        version: row.version,
        status: row.status,
        clientName: row.client_name,
        legalCents: totals.legal_total_cents,
        govCents: totals.gov_total_cents,
        errorCount: issues.filter((i) => i.level === "error").length,
        warningCount: issues.filter((i) => i.level === "warning").length,
        ...(card ? { card } : {}),
      },
    };
  } catch {
    return { status: "failed" };
  }
}

/** What the queue item page shows: nothing for an ordinary draft. */
export type LinkedPanel =
  | { status: "none" }
  | { status: "ok"; proposal: LinkedProposalSummary }
  | { status: "unavailable" };

export async function loadLinkedPanel(queueId: string): Promise<LinkedPanel> {
  const found = await findProposalMarker(queueId);
  if (found.status === "none") return { status: "none" };
  if (found.status === "failed") return { status: "unavailable" };
  const read = await readLinkedProposal(found.marker.proposalId, { withCard: true });
  return read.status === "ok" ? { status: "ok", proposal: read.proposal } : { status: "unavailable" };
}

export type ApproveGate = { ok: true; proposal: { id: string; status: ProposalStatus } | null } | { ok: false; error: string };

/**
 * May the signed-in reviewer approve this queue item? An item with no linked
 * proposal passes untouched. One with a linked proposal needs a named approver
 * AND an approved (or already sent) proposal.
 */
export async function gateLinkedProposal(queueId: string): Promise<ApproveGate> {
  const found = await findProposalMarker(queueId);
  if (found.status === "none") return { ok: true, proposal: null };
  if (found.status === "failed") {
    return { ok: false, error: "Couldn't check the proposal linked to this email. Nothing was approved. Try again shortly." };
  }
  if (!(await isCurrentUserApprover())) {
    return {
      ok: false,
      error: "This email carries a proposal link, so only the firm's named proposal approvers can approve it. Ask one of them to approve it.",
    };
  }
  const read = await readLinkedProposal(found.marker.proposalId);
  if (read.status !== "ok") {
    return { ok: false, error: "Couldn't read the proposal linked to this email. Nothing was approved. Try again shortly." };
  }
  const { id, status } = read.proposal;
  if (status === "approved" || status === "sent") return { ok: true, proposal: { id, status } };
  if (status === "draft") return { ok: false, error: APPROVE_PROPOSAL_FIRST };
  return {
    ok: false,
    error: `The linked proposal is ${status}, so this email can't go out as it is. Reject this draft, or open the proposal and start from there.`,
  };
}

/**
 * Makes the proposal's client link live: approved -> sent (the rpc also
 * supersedes any earlier sent version of the family). Already sent is fine.
 * Called after the queue approval and BEFORE the mailbox draft exists, so the
 * link in the email works the moment a person opens the draft. Returns a
 * sentence on failure; never throws.
 */
export async function makeProposalLive(proposalId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await sendProposal(proposalId);
    return { ok: true };
  } catch (err) {
    // Someone may have marked it sent between the gate and now: that is the goal state.
    const again = await readLinkedProposal(proposalId);
    if (again.status === "ok" && again.proposal.status === "sent") return { ok: true };
    const message = err instanceof ProposalError ? err.message : "the database could not be reached";
    return { ok: false, error: message };
  }
}

/* ── "Mark as sent" for a proposal the consult agent drafted ────────────────── */

export const GOES_LIVE_ON_APPROVAL = "This proposal goes live when an attorney approves its email in the approval queue.";

/**
 * May "Mark as sent" be used on this proposal? Not while the consult agent's
 * email for it is still waiting in the approval queue: the go-live for those
 * happens only by approving that email (`reviewQueueAction`), so the link
 * can't go live before the email that carries it was reviewed. A rejected
 * email frees the proposal (staff may share the link by hand, as for any
 * proposal); an approved one means it already went live.
 *
 * Fails CLOSED: a marker, queue or item that cannot be read blocks it. The
 * caller passes only proposals with `source === 'agent'` (no other proposal
 * has a marker), so an ordinary proposal never pays for this lookup.
 * `queueId` is null when the item is not known (the marker was unreadable).
 */
export type SendBlock = { blocked: false } | { blocked: true; queueId: string | null; reason: "pending" | "unreadable" };

export async function proposalSendBlock(proposalId: string): Promise<SendBlock> {
  if (!UUID.test(proposalId)) return { blocked: false };
  let queueId: string;
  try {
    const supabase = await getScopedClient();
    const { data, error } = await supabase
      .from("crm_activity")
      .select("payload")
      .eq("type", "queue_drafted")
      .eq("payload->>source", CONSULT_PROPOSAL_SOURCE)
      .eq("payload->>proposal_id", proposalId)
      .limit(1);
    if (error) return { blocked: true, queueId: null, reason: "unreadable" };
    const row = (data ?? [])[0] as { payload?: Record<string, unknown> | null } | undefined;
    if (!row) return { blocked: false };
    const id = row.payload?.queue_id;
    if (typeof id !== "string" || !QUEUE_ID.test(id)) return { blocked: true, queueId: null, reason: "unreadable" };
    queueId = id;
  } catch {
    return { blocked: true, queueId: null, reason: "unreadable" };
  }
  try {
    const orgKey = await activeQueueOrgKey();
    if (!orgKey) return { blocked: true, queueId, reason: "unreadable" };
    const item = await getQueueItem(orgKey, queueId);
    if (item.status === "pending") return { blocked: true, queueId, reason: "pending" };
    return { blocked: false };
  } catch {
    return { blocked: true, queueId, reason: "unreadable" };
  }
}
