/**
 * The urgency badge — the one place the three bands become pixels.
 *
 * It is a thin specialisation of `Badge`, not a second chip: `BadgeTone` is
 * named after the bands in `@/lib/deadlines/urgency`, so this component only
 * has to supply the band's own words and let `Badge` do the rest. What it adds
 * is that the words are not the caller's to choose — the label comes from
 * `bandDescriptor`, so the badge, the section heading, the calendar's
 * accessible names and the screen-reader text can never drift apart.
 *
 * COLOUR IS NEVER THE ONLY SIGNAL. Every badge renders the band's TEXT label
 * ("Overdue" / "This week" / "Later"), always, with no dot-only or icon-only
 * mode available to a caller. That is not an accessibility checkbox bolted on
 * afterwards: this dashboard exists because a pretrial conference was missed,
 * and a red dot that a colour-blind reader, a greyscale print-out or a sunlit
 * phone screen renders as "a dot" is exactly the failure that costs a court
 * date.
 *
 * `urgencyTokens` is exported because the deadline list's row rule and the
 * calendar's day markers need the same three colours as the badge, in places
 * Tailwind classes cannot reach (an inline `borderLeftColor`, an SVG-ish
 * glyph). One map, three consumers.
 */

import { Badge } from "@/components/Badge";
import { bandDescriptor, type UrgencyBand } from "@/lib/deadlines/urgency";

export type UrgencyTokens = {
  /** Solid ink — text and dots. */
  ink: string;
  /** Low-alpha wash for row highlights. */
  bg: string;
  /** Border tint, for left rules. */
  border: string;
};

const BAND_TOKENS: Record<UrgencyBand, UrgencyTokens> = {
  overdue: {
    ink: "var(--overdue)",
    bg: "var(--overdue-bg)",
    border: "var(--overdue-border)",
  },
  soon: {
    ink: "var(--soon)",
    bg: "var(--soon-bg)",
    border: "var(--soon-border)",
  },
  later: {
    ink: "var(--later)",
    bg: "var(--later-bg)",
    border: "var(--later-border)",
  },
};

/**
 * The colour triple for a band. Every value is a CSS custom property, which is
 * what makes the badge, the row rule and the calendar dot follow
 * `prefers-color-scheme` together: the tokens are redefined for dark in
 * globals.css, and a saturated ink on a low-alpha wash of itself keeps its
 * contrast in both themes instead of inverting to white-on-red in one of them.
 */
export function urgencyTokens(band: UrgencyBand): UrgencyTokens {
  return BAND_TOKENS[band];
}

export type UrgencyBadgeProps = {
  band: UrgencyBand;
  /** Rendered as "Overdue · 2". Omitted entirely when undefined, not as "0". */
  count?: number;
  /** Secondary phrasing — "12 days overdue". Never replaces the band label. */
  detail?: string;
  className?: string;
};

export function UrgencyBadge({ band, count, detail, className }: UrgencyBadgeProps) {
  const descriptor = bandDescriptor(band);

  return (
    <Badge tone={band} dot title={descriptor.description} className={className}>
      {descriptor.label}
      {count !== undefined ? (
        <span className="font-mono tabular-nums opacity-80">· {count}</span>
      ) : null}
      {detail ? <span className="font-normal opacity-90">· {detail}</span> : null}
    </Badge>
  );
}

export default UrgencyBadge;
