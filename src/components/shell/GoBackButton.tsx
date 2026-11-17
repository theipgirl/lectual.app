"use client";

import { GO_BACK } from "@/lib/ui/words";

/**
 * "Go back" for the 404 pages, drawn as the one back link (`← <label>`). It calls the browser's history directly
 * rather than a router hook, so it renders anywhere. A tab opened straight onto a dead link has nothing to go back
 * to, so it falls through to `fallbackHref`.
 */
export function GoBackButton({ fallbackHref }: { fallbackHref: string }) {
  return (
    <button
      type="button"
      className="lx-back"
      onClick={() => {
        if (window.history.length > 1) window.history.back();
        else window.location.assign(fallbackHref);
      }}
    >
      ← {GO_BACK}
    </button>
  );
}
