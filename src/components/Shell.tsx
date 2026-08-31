import type { ReactNode } from "react";

import { Nav } from "@/components/Nav";

/**
 * Shell — the frame every signed-in screen renders inside.
 *
 * LAYOUT. A persistent dark left rail from `lg` up, carrying the Lectual
 * wordmark, the firm name and the primary nav. Below `lg` the rail would spend
 * 220px of a 390px phone on navigation she already knows, so it collapses to a
 * compact header plus a horizontally scrolling nav strip — five visible labels
 * behind one thumb-swipe, nothing hidden behind a hamburger or an icon whose
 * meaning has to be recalled.
 *
 * BRANDING. This wears LECTUAL's brand — cobalt on warm paper — and never a
 * firm's. The firm appears as its NAME, in text, under the wordmark. That is a
 * deliberate constraint, not an oversight: `crm_org_theme` holds per-firm
 * colours and logos (RPB's row is burnt orange with a logo that spells out
 * "RPB LAW FIRM"), and rendering the active org's theme is exactly how one
 * firm's identity ends up on another firm's screen. The org name is read from
 * the session and passed in; nothing here is hardcoded to any firm.
 *
 * DESIGN COMMITMENTS
 *
 * · Three faces: Bricolage Grotesque for the wordmark, Hanken Grotesk for
 *   body, Space Mono for identifiers — case numbers, stage codes, counts.
 *   Each has a real fallback stack, so a failed webfont degrades rather than
 *   blanking the page.
 * · Every colour comes from a token in `globals.css`. No hex lives in this file.
 * · Dense but not cramped: 8px rhythm, 13–15px text, and a max width that keeps
 *   the deadline list and the month grid side by side on a laptop instead of
 *   stretching them across a 27" monitor.
 * · Print-friendly: the rail and nav drop out entirely, and the firm name is
 *   kept so a printed agenda is identifiable on paper in a courtroom.
 *
 * The Shell knows nothing about auth. It takes strings. `requireSession()`
 * decides who may see a page; the frame just draws it — which keeps the
 * fail-closed branches in one place instead of leaking into layout.
 */

export type ShellProps = {
  children: ReactNode;
  /** Firm name, from the session's active org. Never hardcoded. */
  firmName: string;
  /** Usually the signed-in email. Reassurance, not navigation. */
  userLabel?: string | null;
  /** Role or context line under the user label, e.g. "owner". */
  roleLabel?: string | null;
  /** Right-hand slot: sign-out form, connection chips, quick actions. */
  actions?: ReactNode;
  /** Full-bleed content (a wide board). Default keeps the readable max-width. */
  wide?: boolean;
};

/** The product mark. Lectual's, not the firm's. */
function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={[
        "font-display text-[17px] font-semibold tracking-[-0.02em]",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      Lectual
      <span className="text-accent" aria-hidden="true">
        .
      </span>
    </span>
  );
}

export function Shell({
  children,
  firmName,
  userLabel,
  roleLabel,
  actions,
  wide = false,
}: ShellProps) {
  const container = wide ? "w-full" : "mx-auto w-full max-w-[1440px]";

  return (
    <div className="min-h-dvh bg-surface-2 lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Skip to content
      </a>

      {/* ---------------------------------------------------------- rail */}
      <aside className="sticky top-0 hidden h-dvh w-[216px] shrink-0 flex-col border-r border-rail-border bg-rail px-3 py-4 lg:flex print:hidden">
        <div className="flex min-w-0 flex-col gap-0.5 px-2.5">
          <Wordmark className="text-rail-ink" />
          <span className="truncate text-[13px] font-medium text-rail-muted">
            {firmName}
          </span>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          <Nav variant="rail" />
        </div>

        {(userLabel || roleLabel || actions) && (
          <div className="mt-3 flex flex-col gap-2 border-t border-rail-border px-2.5 pt-3">
            {(userLabel || roleLabel) && (
              <div className="flex min-w-0 flex-col leading-tight">
                {userLabel ? (
                  <span className="truncate text-[12px] font-medium text-rail-ink">
                    {userLabel}
                  </span>
                ) : null}
                {roleLabel ? (
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-rail-muted">
                    {roleLabel}
                  </span>
                ) : null}
              </div>
            )}
            {actions ? <div className="flex flex-col gap-1.5">{actions}</div> : null}
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ------------------------------------------------ mobile header */}
        <header className="sticky top-0 z-30 border-b border-border bg-surface lg:hidden print:static print:border-b-0">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2">
            <div className="flex min-w-0 flex-col leading-tight">
              <Wordmark className="text-ink" />
              <span className="truncate text-[13px] font-medium text-muted">
                {firmName}
              </span>
            </div>

            {actions ? (
              <div className="ml-auto flex items-center gap-2 print:hidden">
                {actions}
              </div>
            ) : null}

            <Nav
              variant="bar"
              className="order-last w-full border-t border-border pt-1.5"
            />
          </div>
        </header>

        <main
          id="main"
          className={`${container} flex-1 px-3 py-4 sm:px-5 sm:py-5 print:px-0`}
        >
          {/* On paper the rail is gone, so reprint the firm name for
              identification. Screen readers already have it from the rail. */}
          <p className="hidden print:mb-3 print:block print:text-sm print:font-semibold">
            {firmName}
          </p>
          {children}
        </main>
      </div>
    </div>
  );
}

export default Shell;
