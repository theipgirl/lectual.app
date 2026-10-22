import Link from "next/link";
import type { NotInLectualItem } from "@/lib/reconcile/types";
import { EvidenceBlock } from "./EvidenceBlock";

export type CreatedLead = { leadId: string } | { error: string };

/**
 * "Not in Lectual yet": people the sheet, Lawmatics or the mailbox know and the app does not. Each has
 * a Create lead button; nothing here is created until it is pressed, and after it is the person is an
 * ordinary lead that the next preview reconciles like any other.
 */
export function NotInLectual({
  items,
  total,
  created,
  busyKey,
  onCreate,
}: {
  items: readonly NotInLectualItem[];
  total: number;
  /** What happened for each person already asked about, by item key. */
  created: Readonly<Record<string, CreatedLead>>;
  busyKey: string | null;
  onCreate?: (item: NotInLectualItem) => void;
}) {
  if (items.length === 0) return null;
  const hidden = Math.max(0, total - items.length);
  return (
    <section className="lx-card" style={{ padding: 18, display: "grid", gap: 12 }} aria-label="Not in Lectual yet">
      <div>
        <div className="lx-label">{`${total} ${total === 1 ? "person" : "people"}`}</div>
        <h2 className="lx-h2" style={{ fontSize: 23 }}>
          Not in Lectual yet
        </h2>
        <p className="lx-note">These people appear in the sheet or in Lawmatics but have no lead here. Nothing is created until you press Create lead.</p>
      </div>
      <ul className="rc-people">
        {items.map((item) => {
          const result = created[item.key];
          const made = result && "leadId" in result ? result : null;
          return (
            <li key={item.key} className="rc-person" data-found={item.found}>
              <div style={{ minWidth: 220, flex: 1 }}>
                <b>{item.name}</b>
                <div>
                  <small className="lx-note">{item.detail}</small>
                </div>
                <EvidenceBlock evidence={item.evidence} lastTouch={item.lastTouch} mailbox={item.mailbox} />
              </div>
              <div className="rc-controls">
                {made ? (
                  <Link href={`/dashboard/leads/${made.leadId}/`} className="lx-btn lx-btn-sec lx-btn-sm">
                    {`Open ${item.name}`}
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="lx-btn lx-btn-sec lx-btn-sm"
                    aria-label={`Create lead for ${item.name}`}
                    disabled={busyKey !== null}
                    onClick={() => onCreate?.(item)}
                  >
                    {busyKey === item.key ? "Creating…" : "Create lead"}
                  </button>
                )}
                {made ? <span role="status" className="lx-note">{"Created. Upload the sheet again to reconcile this lead."}</span> : null}
                {result && "error" in result ? <span role="alert" className="rc-warn">{result.error}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? <p className="lx-note">{`${hidden} more are not listed here. Only the most recently updated ${items.length} are shown.`}</p> : null}
    </section>
  );
}
