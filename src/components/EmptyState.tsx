/**
 * EmptyState — what a region says when it has nothing to show.
 *
 * This component exists because of the single worst bug this dashboard could
 * ship: a panel that renders blank and is read as "nothing is due". That is the
 * exact condition that cost Tracy the Marion County pretrial. An empty region
 * must therefore always say, in words, WHICH question it just answered and
 * WHY the answer is nothing — never a shrug, never a bare dash.
 *
 * So `title` is required and `description` is strongly encouraged, and both
 * should name the scope: not "No deadlines" but "No deadlines in September" or
 * "No open deadlines on this matter — the docket is clear as of today".
 *
 * `tone`:
 *   quiet   (default) a genuinely empty set — grey, calm.
 *   warning the set may be incomplete because something failed (an Outlook
 *           token expired, a fetch threw). Amber, and it says so. Use this
 *           whenever "nothing here" might mean "we could not look".
 *
 * `action` takes a link or button — "Add a deadline", "Reconnect Outlook".
 */

import type { ReactNode } from "react";

export type EmptyStateProps = {
  /** Required. Names the scope of the emptiness in plain words. */
  title: string;
  /** One or two sentences: why it is empty, and what would change that. */
  description?: ReactNode;
  /** Optional call to action — a Link, a form button. */
  action?: ReactNode;
  /** `quiet` = truly empty. `warning` = the result may be incomplete. */
  tone?: "quiet" | "warning";
  /** Tightens padding for use inside a dense list or a lane. */
  compact?: boolean;
  className?: string;
};

export function EmptyState({
  title,
  description,
  action,
  tone = "quiet",
  compact = false,
  className,
}: EmptyStateProps) {
  const warning = tone === "warning";

  return (
    <div
      // Warnings are announced: an incomplete result appearing after a failed
      // fetch should reach a screen-reader user without them re-reading the page.
      role={warning ? "status" : undefined}
      className={[
        "flex flex-col items-start gap-1.5 rounded-sm border border-dashed text-left",
        compact ? "px-3 py-3" : "px-4 py-6",
        warning ? "border-soon-border bg-soon-bg" : "border-border bg-surface-2",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <p
        className={[
          "text-sm font-semibold leading-5",
          warning ? "text-soon" : "text-ink-2",
        ].join(" ")}
      >
        {warning ? <span aria-hidden="true">⚠ </span> : null}
        {title}
      </p>
      {description ? (
        <p className="max-w-prose text-[13px] leading-5 text-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}

export default EmptyState;
