import Link from "next/link";
import type { LegacyProposal } from "@/lib/proposals/legacy";

/** Older proposals on the firm's own proposals page: a link to each, unchanged, with no tracking. */
export function LegacyProposals({ items }: { items: readonly LegacyProposal[] }) {
  if (items.length === 0) return null;
  return (
    <section className="lx-card lx-pad pq-legacy" aria-labelledby="legacy-proposals-h">
      <h2 id="legacy-proposals-h" className="lx-h3">
        Earlier proposals
      </h2>
      <p className="lx-note">
        Made before the proposal builder. The client keeps the same link. Opens, acceptance and payment aren&apos;t tracked here.
      </p>
      <ul className="pq-legacy-list">
        {items.map((p) => (
          <li key={p.url}>
            <strong>{p.client}</strong>
            {p.company && <span>{p.company}</span>}
            <span className="lx-note">
              Sent {p.date} · expires {p.expires}
            </span>
            <a href={p.url} target="_blank" rel="noopener noreferrer">
              Open the client&apos;s page
            </a>
            {p.leadId && <Link href={`/dashboard/leads/${encodeURIComponent(p.leadId)}/`}>Lead</Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}
