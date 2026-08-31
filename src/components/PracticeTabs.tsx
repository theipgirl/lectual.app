"use client";

/**
 * PracticeTabs — the practice switcher above the board.
 *
 * TABS ARE A REGISTRY, NOT A LAYOUT
 * ---------------------------------
 * Every tab is produced by mapping `practicesInOrder()` from
 * `@/lib/practice/resolve`. There is no literal "Litigation" anywhere in this
 * file, no `practice === "litigation"` branch, and no notion of a primary or
 * default tab baked into the markup. Adding a fourth practice, renaming one, or
 * putting Trademark first is a one-line edit to the `PRACTICES` array and
 * nothing here changes. That constraint is deliberate: this firm runs two
 * unrelated practices out of one tenant and neither is the "real" one, so the
 * component that chooses between them must not quietly rank them.
 *
 * COUNTS
 * ------
 * A tab always shows its count, including zero — an empty practice is a real
 * answer ("nothing on the trademark board today") and hiding the tab would make
 * that indistinguishable from the practice not existing. A count that was not
 * supplied renders as an em dash with screen-reader text saying so, rather than
 * as `0`: "we did not count" and "there are none" must never look the same on
 * this dashboard.
 *
 * KEYBOARD (WAI-ARIA tabs pattern)
 * --------------------------------
 * Roving tabindex: exactly one tab is in the tab order at a time; ←/→ move
 * between tabs, Home/End jump to the ends, and the list wraps. In button mode
 * (`onSelect`) arrows also select — activation is free. In link mode (`hrefFor`)
 * arrows only move focus and Enter navigates, because automatic activation
 * would fire a page navigation per keypress.
 *
 * Presentational: it renders tabs and reports which one was chosen. It does not
 * fetch, filter, or know what a panel contains.
 */

import Link from "next/link";
import { useCallback, useRef, type KeyboardEvent } from "react";

import { practicesInOrder, type PracticeId } from "@/lib/practice/resolve";

export type PracticeTabsProps = {
  /** The selected practice. Controlled — this component holds no state. */
  active: PracticeId;
  /**
   * Matter count per practice. A practice missing from this map renders "—",
   * not "0"; see the note above.
   */
  counts?: Readonly<Partial<Record<PracticeId, number>>>;
  /** Button mode. Called with the newly selected practice. */
  onSelect?: (practice: PracticeId) => void;
  /** Link mode. Given a practice, returns its route (e.g. `/pipeline/…`). */
  hrefFor?: (practice: PracticeId) => string;
  /** Ties each tab to the region it controls, for `aria-controls`. */
  panelIdFor?: (practice: PracticeId) => string;
  /** Accessible name of the tablist. */
  label?: string;
  className?: string;
};

export function PracticeTabs({
  active,
  counts,
  onSelect,
  hrefFor,
  panelIdFor,
  label = "Practice",
  className,
}: PracticeTabsProps) {
  const practices = practicesInOrder();
  const tabRefs = useRef<Array<HTMLElement | null>>([]);
  const linkMode = typeof hrefFor === "function";

  const focusTab = useCallback(
    (index: number) => {
      const wrapped = (index + practices.length) % practices.length;
      tabRefs.current[wrapped]?.focus();
      // Automatic activation is safe only when selecting is a local state
      // change. In link mode each activation is a navigation, so arrows move
      // focus and the user presses Enter.
      if (!linkMode) onSelect?.(practices[wrapped].id);
    },
    [linkMode, onSelect, practices],
  );

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>, index: number) => {
      switch (event.key) {
        case "ArrowRight":
        case "ArrowDown":
          event.preventDefault();
          focusTab(index + 1);
          break;
        case "ArrowLeft":
        case "ArrowUp":
          event.preventDefault();
          focusTab(index - 1);
          break;
        case "Home":
          event.preventDefault();
          focusTab(0);
          break;
        case "End":
          event.preventDefault();
          focusTab(practices.length - 1);
          break;
        default:
          break;
      }
    },
    [focusTab, practices.length],
  );

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={[
        "flex flex-wrap items-stretch gap-1 border-b border-border",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {practices.map((practice, index) => {
        const selected = practice.id === active;
        const count = counts?.[practice.id];
        const tabId = `practice-tab-${practice.id}`;
        const panelId = panelIdFor?.(practice.id);

        const shared = {
          id: tabId,
          role: "tab" as const,
          "aria-selected": selected,
          "aria-controls": panelId,
          // Roving tabindex: only the selected tab is reachable by Tab.
          tabIndex: selected ? 0 : -1,
          ref: (node: HTMLElement | null) => {
            tabRefs.current[index] = node;
          },
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, index),
          className: [
            "-mb-px flex items-center gap-2 rounded-t-sm border border-b-0 px-3 py-1.5",
            "text-sm font-semibold leading-5 outline-offset-2",
            "focus-visible:outline-2 focus-visible:outline-accent",
            selected
              ? "border-border bg-surface text-ink"
              : "border-transparent text-muted hover:text-ink-2",
          ].join(" "),
        };

        const body = (
          <>
            <span>{practice.label}</span>
            {count === undefined ? (
              <span className="font-mono text-xs tabular-nums text-muted">
                <span aria-hidden="true">—</span>
                <span className="sr-only">count unavailable</span>
              </span>
            ) : (
              <span
                className={[
                  "rounded-sm px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums",
                  selected ? "bg-surface-3 text-ink-2" : "bg-neutral-bg text-muted",
                ].join(" ")}
              >
                {count}
                <span className="sr-only"> matters</span>
              </span>
            )}
          </>
        );

        return linkMode ? (
          <Link key={practice.id} href={hrefFor(practice.id)} {...shared}>
            {body}
          </Link>
        ) : (
          <button
            key={practice.id}
            type="button"
            onClick={() => onSelect?.(practice.id)}
            {...shared}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

export default PracticeTabs;
