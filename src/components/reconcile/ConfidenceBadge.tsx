import { CONFIDENCE_LABEL, type Proposal } from "@/lib/reconcile/types";
import { MEANING_TONE } from "@/lib/ui/tones";

const TONE = {
  agree: `lx-pill lx-pill-${MEANING_TONE.done}`,
  sheet_only: `lx-pill lx-pill-${MEANING_TONE.neutral}`,
  single_source: `lx-pill lx-pill-${MEANING_TONE.neutral}`,
  conflict: `lx-pill lx-pill-${MEANING_TONE.wrong}`,
  no_evidence: `lx-pill lx-pill-${MEANING_TONE.needsPerson}`,
} as const;

/** The confidence as a labelled badge. Every state has its own words, not colour alone. */
export function ConfidenceBadge({ proposal }: { proposal: Proposal }) {
  if (proposal.kind === "needs_matter" || proposal.confidence === null) {
    return (
      <span className={`lx-pill lx-pill-${MEANING_TONE.needsPerson}`} data-confidence="needs_matter">
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
