"use client";

import { useEffect } from "react";
import { MOVED_CARD_KEY, matterCardId } from "@/lib/matters/list-view";

/** After a Move, the refreshed board brings the moved card back into view and focuses its link. */
export function MovedCardScroller() {
  useEffect(() => {
    let id: string | null = null;
    try {
      id = sessionStorage.getItem(MOVED_CARD_KEY);
      if (id) sessionStorage.removeItem(MOVED_CARD_KEY);
    } catch {
      return;
    }
    if (!id) return;
    const card = document.getElementById(matterCardId(id));
    card?.scrollIntoView({ block: "nearest", inline: "nearest" });
    card?.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
  });
  return null;
}
