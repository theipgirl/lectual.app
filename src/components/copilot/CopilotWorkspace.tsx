"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { newChatNavigation } from "@/lib/copilot/history-pure";
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

  // A real navigation: the server then renders no open chat before the next question, and a later refresh() keeps that key.
  function newChat() {
    const path = newChatNavigation(props.openId, COPILOT_PATH);
    if (path) router.push(path);
  }

  return (
    <div className="cpw">
      <ChatHistoryList history={props.history} openId={props.openId} now={props.now} onNewChat={newChat} />
      <div className="cpw-main">
        {props.openNote && <p className="cpl-status cpw-open-note">{props.openNote}</p>}
        <CopilotChat
          key={props.openId ?? "new"}
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
