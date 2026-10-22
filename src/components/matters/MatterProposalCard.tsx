import Link from "next/link";

/**
 * The matter page's way into a client proposal: one link to New proposal with
 * this matter already chosen, so the form arrives filled from it. The page
 * decides whether to draw it (Proposals module on, and a role that may write
 * proposals); it lists nothing and starts nothing by itself.
 */
export function MatterProposalCard({ matterId }: { matterId: string }) {
  return (
    <section className="lx-card lx-aside" aria-label="Client proposal">
      <div className="lx-label">Client proposal</div>
      <div>
        <Link href={`/dashboard/proposals/new/?matter=${encodeURIComponent(matterId)}`} className="lx-btn lx-btn-sec lx-btn-sm">
          New proposal
        </Link>
      </div>
    </section>
  );
}
