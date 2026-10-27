import "./review.css";
import { parseReviewerSummary, splitForDisplay } from "@/lib/queue/reviewer-summary";

/**
 * "For the reviewer" as a list: CHECK FIRST items first and marked, the rest after, and more than five held behind
 * "Show all" (a plain `<details>`, so it works without JavaScript). A summary that has no items to list (nothing but
 * punctuation) is shown as written rather than dropped.
 */
export function ReviewerSummary({ summary }: { summary: string | null | undefined }) {
  if (!summary || !summary.trim()) return null;
  const items = parseReviewerSummary(summary);
  const { shown, hidden } = splitForDisplay(items);
  return (
    <div className="lx-rv" data-reviewer-summary>
      <div className="lx-label" style={{ fontSize: 11 }}>
        For the reviewer
      </div>
      {items.length === 0 ? (
        <p className="lx-note" style={{ margin: 0, color: "var(--body)" }}>
          {summary}
        </p>
      ) : (
        <>
          <ul className="lx-rv-list">
            {shown.map((item, i) => (
              <ReviewerLine key={i} item={item} />
            ))}
          </ul>
          {hidden.length > 0 && (
            <details className="lx-rv-more">
              <summary>{`Show all ${items.length}`}</summary>
              <ul className="lx-rv-list">
                {hidden.map((item, i) => (
                  <ReviewerLine key={i} item={item} />
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}

function ReviewerLine({ item }: { item: { text: string; checkFirst: boolean } }) {
  return (
    <li className="lx-rv-item" data-check-first={item.checkFirst ? "true" : undefined}>
      {item.checkFirst && <span className="lx-rv-tag">Check first</span>}
      {item.text}
    </li>
  );
}
