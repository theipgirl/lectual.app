import { CONFIDENCE_LABEL, type Proposal } from "@/lib/reconcile/types";

const TONE = {
  agree: "lx-pill lx-pill-ok",
  sheet_only: "lx-pill lx-pill-mute",
  conflict: "lx-pill lx-pill-risk",
  no_evidence: "lx-pill lx-pill-warn",
} as const;

/** The confidence as a labelled badge. Every state has its own words, not colour alone. */
export function ConfidenceBadge({ proposal }: { proposal: Proposal }) {
  if (proposal.kind === "needs_matter" || proposal.confidence === null) {
    return (
      <span className="lx-pill lx-pill-ox" data-confidence="needs_matter">
        Needs a matter
      </span>
    );
  }
  return (
    <span className={TONE[proposal.confidence]} data-confidence={proposal.confidence}>
      {CONFIDENCE_LABEL[proposal.confidence]}
    </span>
  );
}
