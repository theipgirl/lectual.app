import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingTableError } from "@/lib/files/errors";
import { clipContent, readCitations, storableCitations, titleFromQuestion, type SavedMessage } from "./history-pure";
import type { CopilotCitation } from "./sse";

/**
 * Saved Copilot chats (lectual 0099). Reads and writes go through the caller's SCOPED client only: RLS
 * limits every row to its author inside the active firm, so nothing here names a user, and the inserts
 * never name the author column (it has no INSERT grant; it takes auth.uid()). Content, titles and
 * citations are privileged and are never logged.
 *
 * Reads are three-state: ok / not-set-up (0099 not applied: the table is missing, judged on the error
 * CODE) / unavailable. A failed read is never an empty list.
 */

export type ChatSummary = { id: string; title: string; updatedAt: string };

export type ListResult =
  | { status: "ok"; conversations: ChatSummary[] }
  | { status: "not-set-up" }
  | { status: "unavailable" };

export type LoadResult =
  | { status: "ok"; conversation: ChatSummary; messages: SavedMessage[] }
  | { status: "none" }
  | { status: "not-set-up" }
  | { status: "unavailable" };

export type WriteResult = { status: "ok" } | { status: "not-set-up" } | { status: "failed" };

const LIST_LIMIT = 50;

const failure = (error: unknown): "not-set-up" | "unavailable" => (isMissingTableError(error as never) ? "not-set-up" : "unavailable");

export async function listConversations(db: SupabaseClient): Promise<ListResult> {
  try {
    const { data, error } = await db
      .from("copilot_conversation")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false })
      .limit(LIST_LIMIT);
    if (error) return { status: failure(error) };
    const rows = (data ?? []) as Array<{ id: string; title: string; updated_at: string }>;
    return { status: "ok", conversations: rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at })) };
  } catch {
    return { status: "unavailable" };
  }
}

export async function loadConversation(db: SupabaseClient, id: string): Promise<LoadResult> {
  try {
    const head = await db.from("copilot_conversation").select("id, title, updated_at").eq("id", id).maybeSingle();
    if (head.error) return { status: failure(head.error) };
    if (!head.data) return { status: "none" };
    const msgs = await db
      .from("copilot_message")
      .select("id, role, content, citations, created_at")
      .eq("conversation_id", id)
      .order("created_at", { ascending: true })
      .order("role", { ascending: false });
    if (msgs.error) return { status: failure(msgs.error) };
    const h = head.data as { id: string; title: string; updated_at: string };
    const messages = ((msgs.data ?? []) as Array<{ id: string; role: string; content: string; citations: unknown }>)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m): SavedMessage => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content, citations: readCitations(m.citations) }));
    return { status: "ok", conversation: { id: h.id, title: h.title, updatedAt: h.updated_at }, messages };
  } catch {
    return { status: "unavailable" };
  }
}

/** Starts a saved chat. The title is the first question, clipped. Never sends a user id. */
export async function createConversation(
  db: SupabaseClient,
  args: { orgId: string; firstQuestion: string },
): Promise<{ status: "ok"; id: string } | { status: "not-set-up" } | { status: "failed" }> {
  try {
    const { data, error } = await db
      .from("copilot_conversation")
      .insert({ org_id: args.orgId, title: titleFromQuestion(args.firstQuestion) })
      .select("id")
      .single();
    if (error || !data) return error && isMissingTableError(error as never) ? { status: "not-set-up" } : { status: "failed" };
    return { status: "ok", id: (data as { id: string }).id };
  } catch {
    return { status: "failed" };
  }
}

/** One insert for one message. Content is cut to the column's limit; citations are stored as an array. */
export async function saveMessage(
  db: SupabaseClient,
  args: { orgId: string; conversationId: string; id: string; role: "user" | "assistant"; content: string; citations?: readonly CopilotCitation[] },
): Promise<WriteResult> {
  try {
    const { error } = await db.from("copilot_message").insert({
      id: args.id,
      conversation_id: args.conversationId,
      org_id: args.orgId,
      role: args.role,
      content: clipContent(args.content),
      citations: storableCitations(args.citations ?? []),
    });
    if (!error) return { status: "ok" };
    return isMissingTableError(error as never) ? { status: "not-set-up" } : { status: "failed" };
  } catch {
    return { status: "failed" };
  }
}

/** Moves an existing chat to the top of the list. Only `updated_at` is written. */
export async function touchConversation(db: SupabaseClient, id: string, nowIso: string): Promise<WriteResult> {
  try {
    const { error } = await db.from("copilot_conversation").update({ updated_at: nowIso }).eq("id", id);
    return error ? { status: "failed" } : { status: "ok" };
  } catch {
    return { status: "failed" };
  }
}

/** Deletes by id only (messages go with it). RLS means only the author's own chat can match. */
export async function deleteConversation(db: SupabaseClient, id: string): Promise<WriteResult & { deleted?: boolean }> {
  try {
    const { data, error } = await db.from("copilot_conversation").delete().eq("id", id).select("id");
    if (error) return isMissingTableError(error as never) ? { status: "not-set-up" } : { status: "failed" };
    return { status: "ok", deleted: (data ?? []).length > 0 };
  } catch {
    return { status: "failed" };
  }
}

/** Removes one message (used only to undo a question whose answer could not be saved). */
export async function deleteMessage(db: SupabaseClient, id: string): Promise<void> {
  try {
    await db.from("copilot_message").delete().eq("id", id);
  } catch {
    // best effort
  }
}
