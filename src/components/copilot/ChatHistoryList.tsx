"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { CANCEL, DELETE, SAVING, yesVerb } from "@/lib/ui/words";
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

function ChatRow({ id, title, updatedAt, now, tz, open }: { id: string; title: string; updatedAt: string; now: number; tz: string; open: boolean }) {
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
        <span className="cpw-date">{relativeDate(updatedAt, now, tz)}</span>
      </Link>
      {step === "idle" ? (
        <button type="button" className="lx-link cpw-delete" onClick={() => send("ask")} aria-label={`Delete chat: ${title}`} disabled={pending}>
          {pending ? SAVING : DELETE}
        </button>
      ) : (
        <span className="lx-note lx-inline-confirm" role="group" aria-label="Confirm delete">
          Delete this chat?
          <button type="button" className="lx-btn lx-btn-danger lx-btn-sm" onClick={() => send("confirm")} disabled={pending}>
            {yesVerb("delete")}
          </button>
          <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={() => send("cancel")} disabled={pending}>
            {CANCEL}
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
  tz,
  onNewChat,
}: {
  history: ListResult;
  openId: string | null;
  now: number;
  /** The firm's time zone, for the dates. */
  tz: string;
  onNewChat: () => void;
}) {
  return (
    <nav className="cpw-history" aria-label="Past conversations">
      <h2 className="lx-h3 cpw-heading">Past conversations</h2>
      <button type="button" className="lx-btn lx-btn-sec lx-btn-sm cpw-new" onClick={onNewChat} aria-label="New chat">
        New chat
      </button>
      {history.status === "ok" ? (
        history.conversations.length === 0 ? (
          <p className="cpw-note">{SAVED_CHATS_EMPTY}</p>
        ) : (
          <ul className="cpw-list">
            {history.conversations.map((c) => (
              <ChatRow key={c.id} id={c.id} title={c.title} updatedAt={c.updatedAt} now={now} tz={tz} open={c.id === openId} />
            ))}
          </ul>
        )
      ) : history.status === "not-set-up" ? (
        <p className="cpw-note">{SAVED_CHATS_NOT_SET_UP}</p>
      ) : (
        <LoadFailedLine refresh={false}>{SAVED_CHATS_UNAVAILABLE}</LoadFailedLine>
      )}
    </nav>
  );
}
