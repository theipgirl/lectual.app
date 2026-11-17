import { Chip, ChipCount, FilterChips } from "@/components/list-page";
import { OPEN_OFFERS_LABEL } from "@/lib/proposals/list-copy";
import { PROPOSAL_SEGMENTS, SEGMENT_LABEL, type OutWithClients, type ProposalSegment } from "@/lib/proposals/segments";
import { formatMoney } from "@/lib/ui/format";
import { BLANK } from "@/lib/ui/words";

/** "1 proposal is out with a client, counted at the cheapest package offered." */
export function outTileSentence(count: number): string {
  if (count === 0) return "No proposals are out with a client.";
  const lead = count === 1 ? "1 proposal is" : `${count} proposals are`;
  return `${lead} out with a client, counted at the cheapest package offered.`;
}

/**
 * The page's filter row: the segments as the shared chips (counts from the unfiltered set, links as before) and the
 * "Open offers" dollar tile. A count is null (shown as the blank) when it can't be known: Paid while the paid read failed.
 * `counts` and `out` are null/unavailable when the proposals read failed: the page then shows the blank and
 * "couldn't be loaded", never 0 and never "$0".
 */
export function SegmentColumn({
  active,
  counts,
  out,
}: {
  active: ProposalSegment;
  counts: Record<ProposalSegment, number | null> | null;
  out: OutWithClients;
}) {
  return (
    <aside className="pq-side" aria-label="Proposal segments">
      <FilterChips as="nav" label="Show" className="pq-segs">
        {PROPOSAL_SEGMENTS.map((seg) => (
          <Chip
            key={seg}
            href={seg === "everything" ? "/dashboard/proposals/" : `/dashboard/proposals/?segment=${seg}`}
            active={active === seg}
          >
            {SEGMENT_LABEL[seg]}
            {counts ? <ChipCount>{counts[seg] ?? BLANK}</ChipCount> : null}
          </Chip>
        ))}
      </FilterChips>

      <div className="lx-card lx-kpi pq-out">
        <span className="lx-label">{OPEN_OFFERS_LABEL}</span>
        {out.status === "ok" ? (
          <>
            <div className="pq-out-figure">{formatMoney(out.cents)}</div>
            <p className="lx-note">{outTileSentence(out.count)}</p>
          </>
        ) : (
          <>
            <div className="pq-out-figure">{BLANK}</div>
            <p className="lx-note">Open offers couldn&apos;t be loaded.</p>
          </>
        )}
      </div>
    </aside>
  );
}
