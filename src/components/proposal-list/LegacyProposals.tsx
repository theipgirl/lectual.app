import Link from "next/link";
import type { LegacyProposal } from "@/lib/proposals/legacy";

/** Older proposals on the firm's own proposals page: a link to each, unchanged, with no tracking. */
export function LegacyProposals({ items }: { items: readonly LegacyProposal[] }) {
  if (items.length === 0) return null;
  return (
    <section className="lx-card" aria-labelledby="legacy-proposals-h" style={{ marginTop: 16 }}>
      <h2 id="legacy-proposals-h" className="lx-h2" style={{ fontSize: 18, margin: 0 }}>
        Earlier proposals
      </h2>
      <p className="lx-note" style={{ margin: "4px 0 10px" }}>
        Made before the proposal builder. The client keeps the same link. Opens, acceptance and payment aren&apos;t tracked here.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {items.map((p) => (
          <li key={p.url} style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
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
