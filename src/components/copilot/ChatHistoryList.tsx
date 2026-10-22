"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { deleteChatAction } from "@/app/dashboard/copilot/actions";
import {
  nextDeleteStep,
  relativeDate,
  SAVED_CHATS_EMPTY,
  SAVED_CHATS_NOT_SET_UP,
  SAVED_CHATS_UNAVAILABLE,
  type DeleteStep,
} from "@/lib/copilot/history-pure";
import type { ListResult } from "@/lib/copilot/history-store";

export const COPILOT_PATH = "/dashboard/copilot/";

function ChatRow({ id, title, updatedAt, now, open }: { id: string; title: string; updatedAt: string; now: number; open: boolean }) {
  const [step, setStep] = useState<DeleteStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(event: "ask" | "cancel" | "confirm") {
    const next = nextDeleteStep(step, event);
    setStep(next.step);
    if (!next.run) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteChatAction(id);
      if (!res.ok) setError(res.error);
      // The chat on screen is gone: leave it, so the thread does not outlive its record.
      else if (open) window.location.assign(COPILOT_PATH);
    });
  }

  return (
    <li className={open ? "cpw-item cpw-item-open" : "cpw-item"}>
      <Link href={`${COPILOT_PATH}?c=${encodeURIComponent(id)}`} className="cpw-open" aria-current={open ? "page" : undefined}>
        <span className="cpw-title">{title}</span>
        <span className="cpw-date">{relativeDate(updatedAt, now)}</span>
      </Link>
      {step === "idle" ? (
        <button type="button" className="cpw-delete" onClick={() => send("ask")} aria-label={`Delete chat: ${title}`} disabled={pending}>
          Delete
        </button>
      ) : (
        <span className="cpw-confirm" role="group" aria-label="Confirm delete">
          <span className="cpw-confirm-q">Delete this chat?</span>
          <button type="button" className="cpw-delete cpw-delete-yes" onClick={() => send("confirm")} disabled={pending}>
            Yes, delete
          </button>
          <button type="button" className="cpw-delete" onClick={() => send("cancel")} disabled={pending}>
            Cancel
          </button>
        </span>
      )}
      {error && (
        <p className="cpw-error" role="alert">
          {error}
        </p>
      )}
    </li>
  );
}

/** The saved chats, newest first. Three states: a failed or missing read is a sentence, never an empty list. */
export function ChatHistoryList({
  history,
  openId,
  now,
  onNewChat,
}: {
  history: ListResult;
  openId: string | null;
  now: number;
  onNewChat: () => void;
}) {
  return (
    <nav className="cpw-history" aria-label="Past conversations">
      <h2 className="cpw-heading">Past conversations</h2>
      <button type="button" className="cpw-new" onClick={onNewChat} aria-label="New chat">
        New chat
      </button>
      {history.status === "ok" ? (
        history.conversations.length === 0 ? (
          <p className="cpw-note">{SAVED_CHATS_EMPTY}</p>
        ) : (
          <ul className="cpw-list">
            {history.conversations.map((c) => (
              <ChatRow key={c.id} id={c.id} title={c.title} updatedAt={c.updatedAt} now={now} open={c.id === openId} />
            ))}
          </ul>
        )
      ) : history.status === "not-set-up" ? (
        <p className="cpw-note">{SAVED_CHATS_NOT_SET_UP}</p>
      ) : (
        <p className="cpw-note" role="alert">
          {SAVED_CHATS_UNAVAILABLE}
        </p>
      )}
    </nav>
  );
}
