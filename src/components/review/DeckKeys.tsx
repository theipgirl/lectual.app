"use client";

import { useEffect } from "react";

/** Left and right arrows follow the deck's Back and Skip links. Without JavaScript the links still work. */
export function DeckKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable]") || document.querySelector("[aria-modal='true']"))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const link = document.querySelector<HTMLAnchorElement>(e.key === "ArrowLeft" ? "a[data-deck-prev]" : "a[data-deck-next]");
      if (link) {
        e.preventDefault();
        link.click();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return null;
}
