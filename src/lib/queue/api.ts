import "server-only";
import { env } from "@/lib/env";
import { cleanDraftBody, enforceSignOff, isNearDuplicate, movedSummary, signOffSummary } from "./hygiene";

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
  /**
   * The firm's configured sign-off (crm_org_profile.email_signature), for a
   * CLIENT_EMAIL. When the email closes with anyone else's name, createDraft
   * replaces the block with this. Callers that load the profile pass it; when
   * it is absent the closing is left as written and the reviewer is flagged.
   */
  signOff?: string | null;
  /** The firm team sign-off ("The <Firm> Team"), which the proposal email signs on purpose. Always accepted as written. */
  teamSignOff?: string | null;
  /**
   * `false` skips the near-duplicate check, so the caller always gets its OWN
   * queue item back. For a caller that links something to the returned id (the
   * consult proposal marks which proposal an email carries) and so must never be
   * handed another draft's id. Everyone else leaves it unset.
   */
  dedupe?: false;
};

/** What createDraft returns. `deduped` means an equivalent draft was already waiting, so nothing was queued. */
export type CreatedDraft = { id: string; deduped?: boolean };

/**
 * Queues a new draft — the dashboard-side twin of the Cowork skills' MCP
 * `queue_draft` tool, reached over the same HTTP API everything else in this
 * file uses (POST /api/queue, added alongside this call). Used by the
 * Document Center (src/lib/documents/generate.ts) and the filing-followup
 * monthly status update (src/lib/matters/filing-followup-action.ts) so
 * generated content lands in the SAME approval queue as every other draft —
 * never a second storage/approval mechanism. Nothing sends: this only queues
 * text for review, exactly like every other draft type.
 *
 * Every caller passes through the hygiene below (src/lib/queue/hygiene.ts),
 * which is why it lives here and not in the callers:
 *   1. banner and worksheet lines are taken out of the body (and, for a client
 *      email, bracketed instructions), and kept in the reviewer summary;
 *   2. a client email's closing is checked against the firm's sign-off;
 *   3. a draft that nearly repeats one already pending is not queued twice.
 */
export async function createDraft(input: NewQueueDraft): Promise<CreatedDraft> {
  const isEmail = input.type === "CLIENT_EMAIL";
  const cleaned = cleanDraftBody(input.draftBody, { placeholders: isEmail });
  let draftBody = cleaned.body;
  const notes = [input.summary?.trim() || null, movedSummary(cleaned.moved) || null];
  if (isEmail) {
    const signed = enforceSignOff(draftBody, { signOff: input.signOff, teamSignOff: input.teamSignOff });
    draftBody = signed.body;
    notes.push(signOffSummary(signed));
  }
  const summary = notes.filter(Boolean).join("\n\n");

  const existing = input.dedupe === false ? null : await findNearDuplicate(input, draftBody);
  if (existing) return { id: existing, deduped: true };

  return call(`/api/queue`, {
    method: "POST",
    body: JSON.stringify({
      org_id: input.orgKey,
      agent: input.agent,
      type: input.type,
      headline: input.headline,
      draft_body: draftBody,
      ...(summary ? { summary } : {}),
      ...(input.matterId ? { matter_id: input.matterId } : {}),
      ...(input.clientName ? { client_name: input.clientName } : {}),
      ...(input.recipient ? { recipient: input.recipient } : {}),
      ...(input.subject ? { subject: input.subject } : {}),
      ...(input.proposedSendAt ? { proposed_send_at: input.proposedSendAt } : {}),
    }),
  });
}

/**
 * The id of a pending draft in THIS firm's queue that `input` nearly repeats,
 * or null. Fails open: if the pending list can't be read the draft is created
 * anyway, because losing a draft is worse than approving one twice. The log
 * line names the failure and never the draft.
 */
async function findNearDuplicate(input: NewQueueDraft, draftBody: string): Promise<string | null> {
  try {
    const { rows } = await call<{ rows?: QueueItem[] }>(`/api/queue?status=pending&org_id=${encodeURIComponent(input.orgKey)}`);
    if (!Array.isArray(rows)) throw new Error("not a list");
    const probe = {
      type: input.type,
      recipient: input.recipient,
      clientName: input.clientName,
      matterId: input.matterId,
      createdAt: new Date(),
      body: draftBody,
    };
    const match = rows.find((row) =>
      isNearDuplicate(probe, {
        type: row.type,
        recipient: row.recipient,
        clientName: row.client_name,
        matterId: row.matter_id,
        createdAt: row.created_at,
        body: row.final_body ?? row.draft_body,
      }),
    );
    return match?.id ?? null;
  } catch {
    console.error("[queue] near-duplicate check skipped: the pending list could not be read");
    return null;
  }
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
