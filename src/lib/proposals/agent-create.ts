import "server-only";
import { randomUUID } from "node:crypto";
import { ProposalError, friendlyProposalError } from "./errors";
import { checkDraftColumns, generateProposalToken, type ProposalsDbClient } from "./store";
import type { ProposalContent, ProposalRow } from "./types";

/**
 * The consult agent's way to put a DRAFT proposal in the database.
 *
 * `store.ts` is scoped-client only (a signed-in person). The post-consult cron
 * has nobody signed in, so this file takes the client as a parameter and works
 * with EITHER:
 *
 *  - the caller's own scoped client (the "Draft proposal" buttons). RLS then
 *    refuses any org_id but the caller's, and 0089's trigger stamps
 *    created_by / updated_by with the caller. The action has already checked
 *    the staff role (`gateStaffAction`).
 *  - the service-role admin client (the cron). There is no RLS then, so the
 *    fence is explicit: `org_id` is stamped on the inserted row, and the
 *    composite (lead_id, org_id) and (matter_id, org_id) foreign keys refuse a
 *    lead or matter that belongs to another firm.
 *
 * What it can never do: set a status other than 'draft' (0089 refuses it
 * anyway), approve, or send. A draft carrying validation errors is fine (the
 * editor shows them); only approval refuses them.
 *
 * ── THE EVIDENCE EVENT ──────────────────────────────────────────────────────
 * The quotes the agent relied on, and its notes for the approver, are recorded
 * as ONE `edited` event with actor 'agent' and no user. Staff RLS only lets a
 * person insert an event as themselves ('staff', their own id), so the event is
 * written with the admin client, fenced on the proposal's own org
 * (`recordConsultDraftEvent`). The 'created' event comes from the 0089 trigger.
 */

const INSERTED_COLUMNS = "id, org_id, family_id, version, public_token, status, source, client_name, lead_id, matter_id";

export type InsertedAgentProposal = Pick<
  ProposalRow,
  "id" | "org_id" | "family_id" | "version" | "public_token" | "status" | "source" | "client_name" | "lead_id" | "matter_id"
>;

export type AgentProposalInput = {
  orgId: string;
  /** The person who pressed the button; null for the cron. The database trigger stamps it for a signed-in caller. */
  createdBy: string | null;
  clientName: string;
  clientEmail: string | null;
  title: string;
  content: ProposalContent;
  leadId: string | null;
  matterId: string | null;
  expiresOn: string | null;
  payUrl: string | null;
};

export async function insertAgentProposal(db: ProposalsDbClient, input: AgentProposalInput): Promise<InsertedAgentProposal> {
  if (!input.orgId) throw new ProposalError("validation", "A proposal needs a firm.");
  checkDraftColumns({
    clientName: input.clientName,
    clientEmail: input.clientEmail,
    title: input.title,
    expiresOn: input.expiresOn,
    payUrl: input.payUrl,
    content: input.content,
  });

  const id = randomUUID();
  const { data, error } = await db
    .from("client_proposal")
    .insert({
      id,
      org_id: input.orgId,
      family_id: id,
      version: 1,
      public_token: generateProposalToken(),
      lead_id: input.leadId,
      matter_id: input.matterId,
      client_name: input.clientName.trim(),
      client_email: input.clientEmail?.trim() || null,
      title: input.title.trim() || "Trademark Proposal",
      status: "draft",
      content: input.content,
      expires_on: input.expiresOn || null,
      pay_url: input.payUrl?.trim() || null,
      source: "agent",
      created_by: input.createdBy,
      updated_by: input.createdBy,
    })
    .select(INSERTED_COLUMNS)
    .single();
  if (error) throw friendlyProposalError(error, "create the proposal");
  return data as InsertedAgentProposal;
}

/** What the consult agent's 'edited' event carries (read back by proposal-editor/events.ts). */
export type ConsultDraftEventPayload = {
  source: "consult-proposal";
  evidence: Array<{ path: string; quote: string; verified: boolean }>;
  notes: string;
  meeting_id?: string;
  /** For the activity log's sentence ("from the meeting ..."); events are rendered without a lookup. */
  meeting_title?: string;
};

/**
 * Records the evidence + reviewer notes on the proposal, fenced on the
 * proposal's org. `admin` is the service-role client in BOTH paths. Returns
 * false (never throws): the draft and the queue item matter more than their
 * annotation, and the notes are also in the queue item's summary.
 */
export async function recordConsultDraftEvent(
  admin: ProposalsDbClient,
  proposal: Pick<InsertedAgentProposal, "id" | "org_id" | "family_id">,
  payload: ConsultDraftEventPayload,
): Promise<boolean> {
  try {
    const { error } = await admin.from("client_proposal_event").insert({
      org_id: proposal.org_id,
      proposal_id: proposal.id,
      family_id: proposal.family_id,
      type: "edited",
      actor: "agent",
      actor_user_id: null,
      payload,
    });
    if (error) {
      console.error(`[consult-proposal] evidence event failed proposal=${proposal.id}`, error.code);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[consult-proposal] evidence event failed proposal=${proposal.id}`, err);
    return false;
  }
}
