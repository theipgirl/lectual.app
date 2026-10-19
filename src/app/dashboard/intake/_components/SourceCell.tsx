"use client";

import { REFERRAL_SOURCES, type ReferralSource } from "@/lib/intake";
import Popover, { PopoverItem } from "./Popover";

/**
 * A lead's referral source, correctable in place (the same shape as OwnerCell).
 *
 * The menu is REFERRAL_SOURCES plus "None": the bucket list is closed, so a
 * person picks a bucket rather than typing free text the Source filter would
 * never match. The verbatim import text stays in the tooltip (`detail`) — a
 * correction changes the bucket, not the record of what the sheet said.
 *
 * `compact` is the card's version: smaller type, and it reads "Source —" when
 * empty so there is still something to click.
 */
export default function SourceCell({
  leadName,
  source,
  detail,
  pending,
  compact = false,
  onSet,
}: {
  leadName: string;
  /** The stored value; a legacy value outside REFERRAL_SOURCES still renders. */
  source: string | null;
  detail: string | null;
  pending: boolean;
  compact?: boolean;
  onSet: (source: ReferralSource | null) => void;
}) {
  const current = source?.trim() || null;
  const fontSize = compact ? 10.5 : 12.5;

  return (
    <Popover
      label={`Source for ${leadName}: ${current ?? "none"}. Change source`}
      width={170}
      trigger={({ onClick, ref, ...aria }) => (
        <button
          {...aria}
          ref={ref}
          type="button"
          title={detail?.trim() || (current ? current : "No source recorded")}
          disabled={pending}
          onClick={onClick}
          style={{
            font: "inherit",
            fontSize,
            color: current ? "var(--ink2)" : "var(--mute)",
            background: "transparent",
            border: "1px solid transparent",
            borderRadius: 5,
            padding: compact ? "1px 4px" : "2px 5px",
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "left",
            cursor: pending ? "progress" : "pointer",
            opacity: pending ? 0.6 : 1,
          }}
        >
          {current ?? (compact ? "Source —" : "—")}
        </button>
      )}
    >
      {(close) => (
        <>
          <PopoverItem
            muted
            checked={current == null}
            onSelect={() => {
              close();
              if (current != null) onSet(null);
            }}
          >
            None
          </PopoverItem>
          {REFERRAL_SOURCES.map((option) => (
            <PopoverItem
              key={option}
              checked={current === option}
              onSelect={() => {
                close();
                if (current !== option) onSet(option);
              }}
            >
              {option}
            </PopoverItem>
          ))}
        </>
      )}
    </Popover>
  );
}
