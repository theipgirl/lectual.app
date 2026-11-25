"use client";

import { useEffect, useState } from "react";
import { VIEW_AS_FIXED_PATHS } from "@/lib/views/view-as-rules";
import { VIEW_AS_EXIT_FAILED, VIEW_AS_READ_ONLY } from "@/lib/ui/words";
import "./view-as.css";

/**
 * View as, Layer e (a courtesy; nothing relies on it). While previewing, a form submit (other than a GET search or the
 * fixed Exit / sign-out / Enter paths) is cancelled in the capture phase and a quiet note says nothing was changed. The
 * server refuses the write anyway. It also shows the note a refused redirect-style action came back with (?notice=).
 */
export function ReadOnlyPreview() {
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    const notice = new URLSearchParams(window.location.search).get("notice");
    const first = notice === "preview" ? VIEW_AS_READ_ONLY : notice === "view-as-exit-failed" ? VIEW_AS_EXIT_FAILED : null;
    // After the first paint, so the server and browser draw the same markup.
    const shown = first ? window.setTimeout(() => setNote(first), 0) : null;
    const onSubmit = (e: Event) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      if ((form.getAttribute("method") ?? "").toLowerCase() === "get") return;
      const action = form.getAttribute("action") ?? "";
      if ((VIEW_AS_FIXED_PATHS as readonly string[]).some((p) => action === p || action.endsWith(p))) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setNote(VIEW_AS_READ_ONLY);
    };
    document.addEventListener("submit", onSubmit, true);
    return () => {
      if (shown !== null) window.clearTimeout(shown);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 6000);
    return () => window.clearTimeout(t);
  }, [note]);

  return note ? (
    <div role="status" aria-live="polite" className="lx-viewas-toast">
      {note}
    </div>
  ) : null;
}
