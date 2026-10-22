"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { newChatStep } from "@/lib/copilot/history-pure";
import type { Exchange } from "@/lib/copilot/client";
import type { ListResult } from "@/lib/copilot/history-store";
import { ChatHistoryList, COPILOT_PATH } from "./ChatHistoryList";
import { CopilotChat } from "./CopilotChat";
import "./copilot.css";

/**
 * /dashboard/copilot/ below the page title: the saved chats on the left, the chat filling the rest.
 * The server decides what is open (`?c=<id>`) and loads it; New chat navigates back to the bare path.
 */
export function CopilotWorkspace(props: {
  history: ListResult;
  /** The saved chat that is open, when `?c=` named one the person can see. */
  openId: string | null;
  initialExchanges?: Exchange[];
  greeting: string;
  stats: ReactNode;
  /** A sentence about the chat the address named, when it could not be opened. */
  openNote?: string | null;
  /** The server's clock, so relative dates render the same on both sides. */
  now: number;
}) {
  const router = useRouter();
  // Bumped only by New chat on a chat with no `?c=`: remounting the chat empties it and forgets its saved id.
  const [fresh, setFresh] = useState(0);

  // A past chat navigates (the server then renders no open chat, and a later refresh() keeps that key); a fresh one resets.
  function newChat() {
    const step = newChatStep(props.openId, COPILOT_PATH);
    if ("push" in step) router.push(step.push);
    else setFresh((n) => n + 1);
  }

  return (
    <div className="cpw">
      <ChatHistoryList history={props.history} openId={props.openId} now={props.now} onNewChat={newChat} />
      <div className="cpw-main">
        {props.openNote && <p className="cpl-status cpw-open-note">{props.openNote}</p>}
        <CopilotChat
          key={`${props.openId ?? "new"}-${fresh}`}
          variant="page"
          greeting={props.greeting}
          stats={props.stats}
          initialExchanges={props.initialExchanges}
          conversationId={props.openId}
          onNewChat={newChat}
        />
      </div>
    </div>
  );
}
