import Link from "next/link";
import { formatCents } from "@/lib/quotes/money";
import { PROPOSAL_SEGMENTS, SEGMENT_LABEL, type OutWithClients, type ProposalSegment } from "@/lib/proposals/segments";

/** "1 proposal is out with a client, counted at the cheapest package offered." */
export function outTileSentence(count: number): string {
  if (count === 0) return "No proposals are out with a client.";
  const lead = count === 1 ? "1 proposal is" : `${count} proposals are`;
  return `${lead} out with a client, counted at the cheapest package offered.`;
}

/**
 * The page's left column: the five segments with their counts (from the unfiltered set), the
 * "Out with clients" dollar tile, and the note that fees never add into one number. `counts` and
 * `out` are null/unavailable when the proposals read failed: the page then shows "—" and
 * "couldn't be loaded", never 0 and never "$0.00".
 */
export function SegmentColumn({
  active,
  counts,
  out,
  note,
}: {
  active: ProposalSegment;
  counts: Record<ProposalSegment, number> | null;
  out: OutWithClients;
  note: string;
}) {
  return (
    <aside className="pq-side" aria-label="Proposal segments">
      <nav aria-label="Segments" className="pq-segs">
        <div className="lx-label pq-segs-label">Segments</div>
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
        <div className="lx-label">Out with clients</div>
        {out.status === "ok" ? (
          <>
            <div className="pq-out-figure">{formatCents(out.cents)}</div>
            <p className="lx-note">{outTileSentence(out.count)}</p>
          </>
        ) : (
          <>
            <div className="pq-out-figure">—</div>
            <p className="lx-note">Out with clients couldn&apos;t be loaded.</p>
          </>
        )}
      </div>

      <p className="lx-note pq-note">{note}</p>
    </aside>
  );
}
