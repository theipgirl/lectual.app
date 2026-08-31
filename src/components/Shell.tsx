import type { ReactNode } from "react";

import { Nav } from "@/components/Nav";

/**
 * Shell — the frame every signed-in screen renders inside.
 *
 * Deliberately NOT the main app's `Shell.tsx` + `Sidebar.tsx`: this is a
 * single-attorney docket, not a multi-role workspace, and a persistent left
 * rail would spend 220px of a 390px phone screen on navigation she already
 * knows. One thin top bar, five labels, everything else is content.
 *
 * DESIGN COMMITMENTS
 *
 * · Two faces only — the system sans of `--font-body` and the mono of
 *   `--font-mono`. Mono is reserved for things that are *identifiers*: case
 *   numbers, stage codes, counts. Nothing here downloads a webfont, so a
 *   hallway on hotel wifi renders the same bar as a desk on fibre.
 * · Every colour comes from a token in `globals.css`. No hex lives in this file.
 * · Dense but not cramped: 8px rhythm, 13–15px text, a max width that keeps the
 *   deadline list and the month grid side by side on a laptop instead of
 *   stretching them across a 27" monitor.
 * · Print-friendly. The bar loses its sticky positioning, shadow and nav, and
 *   keeps the firm name and page title so a printed agenda is identifiable on
 *   paper in a courtroom.
 * · The bar is sticky, so "what is on fire" is never more than one scroll from
 *   any screen.
 *
 * The Shell knows nothing about auth. It takes strings. `requireSession()`
 * decides who may see a page; the frame just draws it — which keeps the
 * fail-closed branches in one place instead of leaking into layout.
 */

export type ShellProps = {
  children: ReactNode;
  /** Firm name, top-left. The workspace's identity, not the product's. */
  firmName: string;
  /** Usually the signed-in email. Hidden below `sm` — it is reassurance, not navigation. */
  userLabel?: string | null;
  /** Role or context line under the user label, e.g. "owner". */
  roleLabel?: string | null;
  /** Right-hand slot: sign-out form, connection chips, quick actions. */
  actions?: ReactNode;
  /**
   * Full-bleed content (a wide board). Default false keeps the readable
   * max-width.
   */
  wide?: boolean;
};

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
    <div className="flex min-h-dvh flex-col bg-surface-2">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-sm focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-surface print:static print:border-b-0">
        <div
          className={`${container} flex flex-wrap items-center gap-x-5 gap-y-1.5 px-3 py-2 sm:px-5`}
        >
          {/* Identity. The product name is the small kicker; the firm's name is
              the heading — this is her workspace, not our brand. */}
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">
              Docket
            </span>
            <span className="truncate text-[15px] font-semibold tracking-[-0.015em] text-ink">
              {firmName}
            </span>
          </div>

          {/* On a phone the nav drops to its own full-width row and scrolls
              sideways; from md it sits inline beside the firm name. */}
          <Nav className="order-last w-full border-t border-border pt-1.5 md:order-none md:w-auto md:border-0 md:pt-0" />

          {(userLabel || roleLabel || actions) && (
            <div className="ml-auto flex items-center gap-3">
              {(userLabel || roleLabel) && (
                <div className="hidden min-w-0 flex-col items-end leading-tight sm:flex">
                  {userLabel ? (
                    <span className="max-w-[22ch] truncate text-[12px] font-medium text-ink-2">
                      {userLabel}
                    </span>
                  ) : null}
                  {roleLabel ? (
                    <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">
                      {roleLabel}
                    </span>
                  ) : null}
                </div>
              )}
              {actions ? (
                <div className="flex items-center gap-2 print:hidden">{actions}</div>
              ) : null}
            </div>
          )}
        </div>
      </header>

      <main id="main" className={`${container} flex-1 px-3 py-4 sm:px-5 sm:py-5 print:px-0`}>
        {children}
      </main>
    </div>
  );
}

export default Shell;
