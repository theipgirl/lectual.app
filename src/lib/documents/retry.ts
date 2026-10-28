/**
 * "Retry" on a failed letter: run the existing approved-document step again for the same draft.
 * That step (`generateApprovedDocument`) re-renders the REVIEWED text from the approved queue item
 * into a file; nothing new is drafted, queued or sent. Dependencies are injected so the gates, the
 * refusals and the fixed sentences are tested without a database or a queue.
 */
export const RETRY_SENTENCES = {
  notAllowed: "Your role can view documents but not retry them.",
  notFound: "That letter couldn't be found.",
  notFailed: "That letter didn't fail, so there is nothing to retry.",
  noApproval: "This letter has no approved draft to rebuild the file from.",
  noQueue: "Approvals aren't set up for your firm yet, so the file can't be rebuilt.",
  stillFailed: "The letter still couldn't be generated. Try again later.",
  done: "The letter was generated.",
} as const;

export type RetryState = { error?: string; notice?: string };

export type RetryDeps = {
  /** Module gate and write role: a refusal sentence, or null to go ahead. */
  gate: () => Promise<string | null>;
  /** The draft's status and queue item, read through the caller's scoped client (null = not visible). */
  loadDraft: (id: string) => Promise<{ status: string; queue_item_id: string | null } | null>;
  orgKey: () => Promise<string | null>;
  /** The existing step that renders and stores the approved text. Never throws. */
  generate: (orgKey: string, queueItemId: string) => Promise<void>;
  revalidate: () => void;
};

export async function runRetry(deps: RetryDeps, draftId: string): Promise<RetryState> {
  const refused = await deps.gate();
  if (refused) return { error: refused };
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(draftId)) return { error: RETRY_SENTENCES.notFound };

  const draft = await deps.loadDraft(draftId).catch(() => null);
  if (!draft) return { error: RETRY_SENTENCES.notFound };
  if (draft.status !== "failed") return { error: RETRY_SENTENCES.notFailed };
  if (!draft.queue_item_id) return { error: RETRY_SENTENCES.noApproval };

  const orgKey = await deps.orgKey().catch(() => null);
  if (!orgKey) return { error: RETRY_SENTENCES.noQueue };

  await deps.generate(orgKey, draft.queue_item_id);
  deps.revalidate();
  // The step records its own outcome on the row; read it back rather than assuming.
  const after = await deps.loadDraft(draftId).catch(() => null);
  return after?.status === "generated" ? { notice: RETRY_SENTENCES.done } : { error: RETRY_SENTENCES.stillFailed };
}
