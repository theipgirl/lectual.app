/**
 * What the dashboard shows while the next page's server work runs. It sits
 * inside the layout, so the rail and header stay put. Tokens and classes only.
 */
export function PageSkeleton() {
  return (
    <div className="lx-skel" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the page</span>
      <div className="lx-skel-bar lx-skel-label" aria-hidden="true" />
      <div className="lx-skel-bar lx-skel-title" aria-hidden="true" />
      <div className="lx-skel-row" aria-hidden="true">
        <div className="lx-skel-card" />
        <div className="lx-skel-card" />
        <div className="lx-skel-card" />
      </div>
      <div className="lx-skel-block" aria-hidden="true" />
    </div>
  );
}
