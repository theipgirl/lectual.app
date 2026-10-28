"use server";

import { refresh } from "next/cache";
import { getScopedClient } from "@/lib/db/scoped-client";
import { resolveFirmSession } from "@/lib/firm/session";
import { deleteConversation } from "@/lib/copilot/history-store";

/**
 * Copilot history actions. Scoped client only: RLS (lectual 0099) limits every row to its author, so the
 * action takes no user and no firm, only the chat's id. Every outcome is a fixed sentence; nothing about a
 * chat (title, content) is returned, logged or put in an error.
 */

export type DeleteChatResult = { ok: true } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DELETE_CHAT_MESSAGES = {
  signedOut: "Sign in to delete a saved chat.",
  badId: "That chat couldn't be found.",
  notSetUp: "Saved chats aren't switched on for your firm yet. Lectual will turn them on.",
  failed: "The chat couldn't be deleted. Try again.",
} as const;

export async function deleteChatAction(id: string): Promise<DeleteChatResult> {
  try {
    const session = await resolveFirmSession();
    if (session.kind !== "ok") return { ok: false, error: DELETE_CHAT_MESSAGES.signedOut };
    if (typeof id !== "string" || !UUID.test(id)) return { ok: false, error: DELETE_CHAT_MESSAGES.badId };
    const db = await getScopedClient();
    const result = await deleteConversation(db as never, id);
    if (result.status === "not-set-up") return { ok: false, error: DELETE_CHAT_MESSAGES.notSetUp };
    if (result.status === "failed") return { ok: false, error: DELETE_CHAT_MESSAGES.failed };
    if (!result.deleted) return { ok: false, error: DELETE_CHAT_MESSAGES.badId };
    refresh();
    return { ok: true };
  } catch {
    return { ok: false, error: DELETE_CHAT_MESSAGES.failed };
  }
}

/** Asks the page to re-read the history list after a chat is saved. Reads and writes nothing. */
export async function refreshHistoryAction(): Promise<void> {
  refresh();
}
