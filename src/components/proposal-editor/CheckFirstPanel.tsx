import type { ProposalCardReceipts } from "@/lib/proposals/card";
import { parseReviewerSummary } from "@/lib/queue/reviewer-summary";
import { checkTheseHeading } from "@/lib/proposal-editor/vocabulary";

/**
 * For a draft the assistant made: the things to check before the link goes live, at the top of the page. It is the
 * assistant's own CHECK FIRST notes and the quotes from the call it relied on, exactly as stored on the proposal
 * (nothing is rewritten and nothing is read again from the call). A person's own draft has no panel. If the stored
 * notes couldn't be read the panel says so; it never reads as "nothing to check".
 */
/** Does the panel draw (and so put a "Check these" heading on the page)? The same test the component makes, for the page. */
export function checkFirstShown(receipts: ProposalCardReceipts): boolean {
  if (receipts.status === "none") return false;
  if (receipts.status === "unavailable") return true;
  return parseReviewerSummary(receipts.notes).filter((i) => i.checkFirst).length + receipts.unverified.length + receipts.verified.length > 0;
}

export function CheckFirstPanel({ receipts }: { receipts: ProposalCardReceipts }) {
  if (receipts.status === "none") return null;
  if (receipts.status === "unavailable") {
    return (
      <section className="lx-card pe-check-first" aria-label="Check these things">
        <h2 className="pe-h">Check these things</h2>
        <p className="lx-note" role="status">
          The assistant&rsquo;s notes couldn&rsquo;t be loaded. Refresh to try again.
        </p>
      </section>
    );
  }
  const flags = parseReviewerSummary(receipts.notes).filter((i) => i.checkFirst);
  const unverified = receipts.unverified.map((q) => ({ text: q, kind: "Heard on the call, not matched word for word" }));
  const verified = receipts.verified.map((q) => ({ text: q, kind: "Heard on the call" }));
  const total = flags.length + unverified.length + verified.length;
  if (total === 0) return null;
  return (
    <section className="lx-card pe-check-first" aria-label="Check these things" data-check-first>
      <h2 className="pe-h">{checkTheseHeading(total)}</h2>
      <ol className="pe-check-list">
        {flags.map((f, i) => (
          <li key={`f${i}`}>
            <span className="lx-pill lx-pill-warn">Check first</span> {f.text}
          </li>
        ))}
        {unverified.map((q, i) => (
          <li key={`u${i}`}>
            <span className="lx-note">{q.kind}: </span>“{q.text}”
          </li>
        ))}
        {verified.map((q, i) => (
          <li key={`v${i}`}>
            <span className="lx-note">{q.kind}: </span>“{q.text}”
          </li>
        ))}
      </ol>
      {receipts.more > 0 && <p className="lx-note">{receipts.more} more quotes are in the activity history below.</p>}
    </section>
  );
}
