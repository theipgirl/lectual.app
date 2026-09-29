import "server-only";
import { env } from "@/lib/env";

/**
 * Client for the lawmatics-mcp approval-queue API (app/api/queue/* there).
 * The dashboard is a thin surface over that server: same queue the Cowork
 * skills write via `queue_draft`, same resolve logic `resolve_draft` runs.
 * Spec: lectual-plugin docs/specs/2026-07-13-dashboard-queue-wiring.md.
 *
 * DASHBOARD_API_TOKEN never reaches the browser — every call happens in an
 * RSC or server action.
 */

export type QueueItem = {
  id: string;
  org_id: string;
  matter_id: string | null;
  agent: string;
  type: string;
  headline: string;
  summary: string | null;
  draft_body: string;
  final_body: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  client_name: string | null;
  recipient: string | null;
  subject: string | null;
  proposed_send_at: string | null;
  attachments: Array<{ name: string; ref: string }> | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
};

export type ResolveAction = "approve" | "reject";

function config() {
  const base = env.QUEUE_API_URL?.replace(/\/$/, "");
  const token = env.DASHBOARD_API_TOKEN;
  if (!base || !token) {
    throw new Error(
      "Queue API not configured — set QUEUE_API_URL and DASHBOARD_API_TOKEN",
    );
  }
  return { base, token };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const { base, token } = config();
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = ((await res.json()) as { error?: string }).error ?? detail;
    } catch {
      // non-JSON error body
    }
    throw new Error(`Queue API ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

/**
 * Every function here takes orgKey explicitly and sends it as org_id.
 *
 * It is a required parameter rather than something resolved inside this
 * module on purpose: the queue is outside the tenant-scoped database, so this
 * value is the only thing separating one firm's privileged client drafts from
 * another's. Making it required means a forgotten scope is a compile error,
 * not a silent cross-tenant read. Get it from activeQueueOrgKey().
 */
export async function listQueue(
  orgKey: string,
  status: "pending" | "approved" | "rejected",
): Promise<QueueItem[]> {
  const { rows } = await call<{ rows: QueueItem[] }>(
    `/api/queue?status=${status}&org_id=${encodeURIComponent(orgKey)}`,
  );
  return rows;
}

export type NewQueueDraft = {
  orgKey: string;
  agent: string;
  type: string;
  headline: string;
  draftBody: string;
  summary?: string;
  matterId?: string;
  clientName?: string;
  /** Only meaningful for a CLIENT_EMAIL draft — lawmatics-mcp's resolveQueueItem
   * uses this (plus a configured DraftMailClient) to create the approved draft
   * as a real Outlook message. Omitted entirely for every other draft type,
   * same as summary/matterId/clientName above. */
  recipient?: string;
  subject?: string;
  /** ISO datetime — "when we'd propose sending this," never a real
   * schedule; the queue never sends anything on its own. */
  proposedSendAt?: string;
};

/**
 * Queues a new draft — the dashboard-side twin of the Cowork skills' MCP
 * `queue_draft` tool, reached over the same HTTP API everything else in this
 * file uses (POST /api/queue, added alongside this call). Used by the
 * Document Center (src/lib/documents/generate.ts) and the filing-followup
 * monthly status update (src/lib/matters/filing-followup-action.ts) so
 * generated content lands in the SAME approval queue as every other draft —
 * never a second storage/approval mechanism. Nothing sends: this only queues
 * text for review, exactly like every other draft type.
 */
export async function createDraft(input: NewQueueDraft): Promise<{ id: string }> {
  return call(`/api/queue`, {
    method: "POST",
    body: JSON.stringify({
      org_id: input.orgKey,
      agent: input.agent,
      type: input.type,
      headline: input.headline,
      draft_body: input.draftBody,
      ...(input.summary ? { summary: input.summary } : {}),
      ...(input.matterId ? { matter_id: input.matterId } : {}),
      ...(input.clientName ? { client_name: input.clientName } : {}),
      ...(input.recipient ? { recipient: input.recipient } : {}),
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.proposedSendAt ? { proposed_send_at: input.proposedSendAt } : {}),
    }),
  });
}

export async function getQueueItem(orgKey: string, id: string): Promise<QueueItem> {
  const { row } = await call<{ row: QueueItem }>(
    `/api/queue/${encodeURIComponent(id)}?org_id=${encodeURIComponent(orgKey)}`,
  );
  return row;
}

/** Save an edit on a pending item. The original stays in draft_body for the improvement loop. */
export async function saveQueueEdit(orgKey: string, id: string, body: string): Promise<void> {
  await call(
    `/api/queue/${encodeURIComponent(id)}?org_id=${encodeURIComponent(orgKey)}`,
    {
      method: "PATCH",
      body: JSON.stringify({ body }),
    },
  );
}

/**
 * Approve or reject — runs the SAME resolve logic as the `resolve_draft` MCP
 * tool, server-side in lawmatics-mcp. Nothing sends autonomously: approving a
 * client email creates it in the firm's Outlook Drafts and a human presses
 * Send. The returned `send`/`sendResult` say what actually happened — surface
 * them, never assume "approved" means "delivered".
 */
/**
 * What the queue service did about actually delivering the approved message.
 *
 * `drafted` means it now sits in the firm's Outlook Drafts and a human still
 * has to press Send — that is the designed end state, not a half-failure.
 * `manual` means this type is never emailed (a USPTO response is filed, not
 * sent). `failed` means the approval was recorded but delivery did not
 * happen, and someone must act.
 */
export type QueueSendStatus = "drafted" | "sent" | "manual" | "none" | "failed";

export type QueueSendResult = {
  /** One human-readable sentence to show the reviewer. Always present. */
  detail: string;
  /** Deep link to the created Outlook draft, when there is one. */
  webLink?: string;
  error?: string;
  /** False when the outcome columns aren't migrated yet — the send still happened. */
  recorded?: boolean;
};

export async function resolveQueueItem(args: {
  orgKey: string;
  id: string;
  action: ResolveAction;
  resolvedBy: string;
  note?: string;
  finalBody?: string;
}): Promise<{
  status: "approved" | "rejected";
  send: QueueSendStatus;
  sendResult?: QueueSendResult;
}> {
  return call(`/api/queue/${encodeURIComponent(args.id)}/resolve`, {
    method: "POST",
    body: JSON.stringify({
      action: args.action,
      org_id: args.orgKey,
      resolved_by: args.resolvedBy,
      ...(args.note ? { note: args.note } : {}),
      ...(args.finalBody ? { final_body: args.finalBody } : {}),
    }),
  });
}
