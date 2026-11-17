"use client";

import { useEffect } from "react";
import { markDeckSeenAction } from "@/lib/account/deck-seen-actions";

/**
 * Draws nothing. After mount (never during render) it asks the server to stamp "the deck was opened", which clears the
 * deal-ready dot the next time the shell is drawn (a later navigation). The server decides whether anything is written.
 * Quiet on failure. The deck page mounts it only when the person is not Lectual staff acting inside a firm.
 */
export function DeckSeenMark() {
  useEffect(() => {
    markDeckSeenAction().catch(() => {});
  }, []);
  return null;
}
