"use client";

import { useState, type ReactNode } from "react";
import type { Exchange } from "@/lib/copilot/client";
import type { ListResult } from "@/lib/copilot/history-store";
import { ChatHistoryList, COPILOT_PATH } from "./ChatHistoryList";
import { CopilotChat } from "./CopilotChat";
import "./copilot.css";

/**
 * /dashboard/copilot/ below the page title: the saved chats on the left, the chat filling the rest.
 * The server decides what is open (`?c=<id>`) and loads it; this only remembers a "New chat" press so
 * the chat starts clean even when the address does not change.
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
  const [fresh, setFresh] = useState(0);
  const [cleared, setCleared] = useState(false);

  function newChat() {
    setCleared(true);
    setFresh((n) => n + 1);
    if (props.openId) window.history.pushState(null, "", COPILOT_PATH);
  }

  const showOpen = !cleared;
  return (
    <div className="cpw">
      <ChatHistoryList history={props.history} openId={showOpen ? props.openId : null} now={props.now} onNewChat={newChat} />
      <div className="cpw-main">
        {props.openNote && showOpen && <p className="cpl-status cpw-open-note">{props.openNote}</p>}
        <CopilotChat
          key={`${showOpen ? (props.openId ?? "new") : "new"}-${fresh}`}
          variant="page"
          greeting={props.greeting}
          stats={props.stats}
          initialExchanges={showOpen ? props.initialExchanges : undefined}
          conversationId={showOpen ? props.openId : null}
        />
      </div>
    </div>
  );
}
