import type { SupabaseClient } from "@supabase/supabase-js";
import { createConversation, deleteConversation, deleteMessage, loadConversation, saveMessage, touchConversation } from "./history-store";
import type { CopilotFinal } from "./sse";

/**
 * Saves one finished exchange: the question and the FINAL answer (never the streamed text), one insert per
 * message, through the signed-in scoped client. Called by the route after `final` has been sent, so it can
 * only add a note; it never changes what the person saw.
 *
 * A question is saved only together with its answer: if the answer cannot be saved, the question is taken
 * back out (and a chat this call created is removed), so no orphan question is left behind.
 *
 * A conversation id the caller cannot see (another person's, another firm's, a deleted one) is treated as no
 * id: the exchange starts a new saved chat. Nothing about the other chat is read or revealed.
 */
export type SaveTurnResult = { status: "saved"; conversationId: string } | { status: "not-set-up" } | { status: "failed" };

export async function saveTurn(
  db: SupabaseClient,
  args: { orgId: string; conversationId?: string; question: string; result: CopilotFinal; newId?: () => string; now?: () => number },
): Promise<SaveTurnResult> {
  const newId = args.newId ?? (() => crypto.randomUUID());
  const now = args.now ?? Date.now;

  let conversationId: string | null = null;
  let created = false;
  if (args.conversationId) {
    const existing = await loadConversation(db, args.conversationId);
    if (existing.status === "not-set-up") return { status: "not-set-up" };
    if (existing.status === "unavailable") return { status: "failed" };
    if (existing.status === "ok") conversationId = existing.conversation.id;
  }
  if (!conversationId) {
    const made = await createConversation(db, { orgId: args.orgId, firstQuestion: args.question });
    if (made.status !== "ok") return { status: made.status };
    conversationId = made.id;
    created = true;
  }

  const questionId = newId();
  const asked = await saveMessage(db, { orgId: args.orgId, conversationId, id: questionId, role: "user", content: args.question });
  if (asked.status !== "ok") {
    if (created) await deleteConversation(db, conversationId);
    return { status: asked.status === "not-set-up" ? "not-set-up" : "failed" };
  }
  const answered = await saveMessage(db, {
    orgId: args.orgId,
    conversationId,
    id: newId(),
    role: "assistant",
    content: args.result.answer,
    citations: args.result.citations,
  });
  if (answered.status !== "ok") {
    if (created) await deleteConversation(db, conversationId);
    else await deleteMessage(db, questionId);
    return { status: answered.status === "not-set-up" ? "not-set-up" : "failed" };
  }
  if (!created) await touchConversation(db, conversationId, new Date(now()).toISOString());
  return { status: "saved", conversationId };
}
