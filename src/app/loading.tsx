/**
 * The loading state for `/` (and for any route below it that has none of its
 * own).
 *
 * IT SAYS "LOADING", IN WORDS, ABOVE THE FOLD.
 *
 * A skeleton screen is a picture of a dashboard with nothing on it, and this
 * particular dashboard exists because "nothing on it" was once mistaken for
 * "nothing is due" — a missed pretrial conference. So the placeholder blocks
 * below are never left to speak for themselves: the first thing rendered is a
 * live region that says the docket is still loading and that no count on the
 * screen is real yet. Every placeholder count is an em dash, never a zero.
 *
 * It mirrors the real page's geometry — list beside grid, `UP NEXT` beneath,
 * board, strip — so the layout does not jump when the data lands.
 *
 * No `Shell` here: the firm's name is a server read that has not happened yet,
 * and putting a placeholder where a law firm's name goes is worse than leaving
 * the frame off for the moment it takes.
 */

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1440px] px-3 py-4 sm:px-5 sm:py-5">
      <div className="grid gap-4">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-xl font-semibold tracking-[-0.015em] text-ink">Today</h1>
          <p role="status" aria-live="polite" className="text-sm text-ink-2">
            Loading the docket…
          </p>
          <p className="ml-auto font-mono text-sm tabular-nums text-muted">
            <span aria-hidden="true">— open · — overdue</span>
            <span className="sr-only">Counts not loaded yet.</span>
          </p>
        </header>

        {/* Deadline list beside the month grid, same shape as the real page. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start">
          <PanelSkeleton label="Deadlines" lines={6} />
          <PanelSkeleton label="Calendar" lines={6} />
        </div>

        <PanelSkeleton label="Up next" lines={4} />
        <PanelSkeleton label="Practice board" lines={5} />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {["Demands waiting", "Unconfirmed dates", "Stalled cases", "Consults not converted"].map(
            (label) => (
              <div
                key={label}
                className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-3 py-2.5"
              >
                <span className="font-mono text-2xl font-semibold leading-8 text-muted">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">not loaded yet</span>
                </span>
                <span className="text-[13px] font-semibold leading-4 text-ink-2">{label}</span>
              </div>
            ),
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * One placeholder card. The heading is real text rather than a grey bar, so the
 * page is navigable and announceable while it loads; only the rows below it are
 * bars, and they are `aria-hidden` because a screen reader has nothing to gain
 * from being read a rectangle.
 */
function PanelSkeleton({ label, lines }: { label: string; lines: number }) {
  return (
    <section className="rounded-md border border-border bg-surface shadow-[var(--shadow)]">
      <header className="border-b border-border px-4 py-2.5">
        <span className="font-mono text-[11px] font-semibold uppercase leading-4 tracking-[0.09em] text-muted">
          {label}
        </span>
      </header>
      <div className="grid gap-2 p-4" aria-hidden="true">
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className="h-4 animate-pulse rounded-sm bg-surface-3"
            // A descending ladder reads as content rather than as a wall of
            // identical bars, without implying any particular row is real.
            style={{ width: `${100 - i * 9}%` }}
          />
        ))}
      </div>
    </section>
  );
}
