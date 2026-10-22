"use client";

/**
 * Shown when a dashboard page's server work fails (a 503 on a report switch, a
 * calendar week, anything). It says so in a fixed sentence, never raw error
 * text, and never leaves a stale or blank page looking like a result.
 */
export function DashboardError({ retry }: { retry: () => void }) {
  return (
    <div className="lx-banner lx-banner-warn" role="alert" style={{ display: "grid", gap: 10 }}>
      <strong>This page couldn&apos;t be loaded.</strong>
      <span>Nothing is missing. The page just didn&apos;t answer. Try again, or go back to the page you were on.</span>
      <span>
        <button type="button" className="lx-btn lx-btn-sec lx-btn-sm" onClick={retry}>
          Try again
        </button>
      </span>
    </div>
  );
}
