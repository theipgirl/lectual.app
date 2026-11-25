"use client";

import { useEffect } from "react";
import { removeLegacyColumnPrefs } from "@/lib/review/legacy-column-prefs";

/** Draws nothing. After mount it deletes the old per-person column choice from this browser (once is enough; removing a missing key is a no-op). */
export function LegacyColumnPrefsCleaner() {
  useEffect(() => {
    try {
      removeLegacyColumnPrefs(window.localStorage);
    } catch {
      // Storage can throw (private window, blocked site data): nothing to clean, nothing to show.
    }
  }, []);
  return null;
}
