import type { ReactNode } from "react";

/**
 * ONE card for everything waiting on a person: the booked consult, drafts waiting for approval,
 * client-email proposals and stage suggestions. The page decides whether there is anything to
 * show (`needsAttention`) and only renders this card then, so it is never an empty box.
 */
export function NeedsAttentionCard({ children }: { children: ReactNode }) {
  return (
    <section id="needs-attention" className="lx-card lx-needs" style={{ padding: 18, display: "grid", gap: 14 }} aria-labelledby="needs-attention-heading">
      <h2 id="needs-attention-heading" className="lx-h2" style={{ fontSize: 23, margin: 0 }}>
        Needs attention
      </h2>
      {children}
    </section>
  );
}
