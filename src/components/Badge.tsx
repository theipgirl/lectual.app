/**
 * Badge — a small, high-contrast status chip.
 *
 * The urgency tones are named exactly like the bands in
 * `@/lib/deadlines/urgency` (`overdue` · `soon` · `later`), so a caller writes
 * `<Badge tone={band}>{label}</Badge>` with no lookup table in between.
 *
 * TWO RULES THIS COMPONENT ENFORCES
 *
 * 1. Colour is never the only signal. The badge always renders its children as
 *    text, so an overdue chip reads "Overdue" to someone who cannot separate
 *    red from amber, and to a screen reader. There is no icon-only mode and no
 *    `children`-less variant — that is why `children` is required.
 * 2. It carries no layout. No margins, no width, no positioning. The parent
 *    owns spacing, which keeps the badge reusable inside a list row, a table
 *    cell, a calendar legend and a card header without overrides.
 *
 * Props:
 *   tone      visual band — defaults to `neutral`
 *   dot       show a leading ● in the tone's ink (for legends and dense rows)
 *   mono      render in the mono face (case numbers, stage codes, counts)
 *   title     native tooltip; pass the band's longer description here
 *   className extra classes, appended last so a caller can win a conflict
 */

import type { ReactNode } from "react";

/** Three urgency bands plus two non-urgency tones. */
export type BadgeTone = "overdue" | "soon" | "later" | "neutral" | "accent";

export type BadgeProps = {
  children: ReactNode;
  tone?: BadgeTone;
  dot?: boolean;
  mono?: boolean;
  title?: string;
  className?: string;
};

const TONE_CLASSES: Record<BadgeTone, string> = {
  overdue: "bg-overdue-bg text-overdue border-overdue-border",
  soon: "bg-soon-bg text-soon border-soon-border",
  later: "bg-later-bg text-later border-later-border",
  neutral: "bg-neutral-bg text-muted border-border",
  accent: "bg-accent text-accent-ink border-transparent",
};

export function Badge({
  children,
  tone = "neutral",
  dot = false,
  mono = false,
  title,
  className,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={[
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border px-1.5 py-0.5",
        "text-[11px] font-semibold leading-4 tracking-[0.01em]",
        mono ? "font-mono tracking-normal" : "",
        TONE_CLASSES[tone],
        // Printed pages are monochrome often enough that a tinted background
        // becomes a grey smudge; keep the border and the words.
        "print:bg-transparent",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {dot ? (
        <span aria-hidden="true" className="text-[8px] leading-none">
          ●
        </span>
      ) : null}
      {children}
    </span>
  );
}

export default Badge;
