"use client";

import { REFRESH, PAGE_DIDNT_ANSWER, cantShowTitle } from "@/lib/ui/words";

/**
 * Shown when a dashboard page's server work fails (a 503 on a report switch, a
 * calendar week, anything). It says so in a fixed sentence, never raw error
 * text, and never leaves a stale or blank page looking like a result. The same
 * card as a failed list (`LoadFailedCard`), with a button that retries the
 * page's server work (`retry`), which a plain router refresh would not.
 */
export function DashboardError({ retry }: { retry: () => void }) {
  return (
    <div className="lx-card lx-state-card" role="alert">
      <h2 className="lx-h2">{cantShowTitle("this page")}</h2>
      <p className="lx-note">{PAGE_DIDNT_ANSWER}</p>
      <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={retry}>
        {REFRESH}
      </button>
    </div>
  );
}
