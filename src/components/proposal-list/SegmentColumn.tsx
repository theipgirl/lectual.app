import Link from "next/link";
import { formatCents } from "@/lib/quotes/money";
import { OPEN_OFFERS_LABEL } from "@/lib/proposals/list-copy";
import { PROPOSAL_SEGMENTS, SEGMENT_LABEL, type OutWithClients, type ProposalSegment } from "@/lib/proposals/segments";

/** "1 proposal is out with a client, counted at the cheapest package offered." */
export function outTileSentence(count: number): string {
  if (count === 0) return "No proposals are out with a client.";
  const lead = count === 1 ? "1 proposal is" : `${count} proposals are`;
  return `${lead} out with a client, counted at the cheapest package offered.`;
}

/**
 * The page's left column: "Show", the five segments with their counts (from the unfiltered set), and the
 * "Open offers" dollar tile. Under 760px the segments lie down as a row of chips. `counts` and
 * `out` are null/unavailable when the proposals read failed: the page then shows "—" and
 * "couldn't be loaded", never 0 and never "$0.00".
 */
export function SegmentColumn({
  active,
  counts,
  out,
}: {
  active: ProposalSegment;
  counts: Record<ProposalSegment, number> | null;
  out: OutWithClients;
}) {
  return (
    <aside className="pq-side" aria-label="Proposal segments">
      <nav aria-label="Show" className="pq-segs">
        <div className="lx-label pq-segs-label">Show</div>
        {PROPOSAL_SEGMENTS.map((seg) => (
          <Link
            key={seg}
            href={seg === "everything" ? "/dashboard/proposals/" : `/dashboard/proposals/?segment=${seg}`}
            aria-current={active === seg ? "page" : undefined}
            className="pq-seg"
          >
            <span>{SEGMENT_LABEL[seg]}</span>
            {counts && <span className="pq-count">{counts[seg]}</span>}
          </Link>
        ))}
      </nav>

      <div className="pq-out">
        <div className="lx-label">{OPEN_OFFERS_LABEL}</div>
        {out.status === "ok" ? (
          <>
            <div className="pq-out-figure">{formatCents(out.cents)}</div>
            <p className="lx-note">{outTileSentence(out.count)}</p>
          </>
        ) : (
          <>
            <div className="pq-out-figure">—</div>
            <p className="lx-note">Open offers couldn&apos;t be loaded.</p>
          </>
        )}
      </div>
    </aside>
  );
}
