"use client";

import { useEffect } from "react";
import { VIEW_AS_EXIT_PATH } from "@/lib/views/view-as-rules";
import { VIEW_AS_LEAVE, VIEW_AS_STALE } from "@/lib/ui/words";
import "./view-as.css";

/**
 * The hint cookie is present but the database says no preview is open (it was closed as access_ended or timed out, or
 * View as isn't switched on). The proxy would otherwise answer 409 to every write until the cookie expires. So this posts
 * to the Exit route once, in the background (Exit clears the cookie; with nothing open it writes nothing), and shows a
 * "Leave preview" button that does the same, in case the background call didn't land.
 */
export function StalePreviewCookie() {
  useEffect(() => {
    void fetch(VIEW_AS_EXIT_PATH, { method: "POST", credentials: "same-origin", redirect: "manual" }).catch(() => undefined);
  }, []);
  return (
    <div role="status" className="lx-viewas-bar" data-view-as="stale">
      <span className="lx-viewas-text">{VIEW_AS_STALE}</span>
      <form action={VIEW_AS_EXIT_PATH} method="post">
        <button type="submit" className="lx-viewas-exit">
          {VIEW_AS_LEAVE}
        </button>
      </form>
    </div>
  );
}
