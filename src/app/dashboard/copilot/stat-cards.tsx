import Link from "next/link";
import type { StatCardData } from "@/lib/copilot/stats";

/**
 * The four glass cards on the copilot's landing state. A number, or a dash with
 * the reason in words ("Couldn't load", "Queue isn't connected"): a failed read
 * is never a zero.
 */
export function StatCards({ cards }: { cards: StatCardData[] }) {
  return (
    <div className="cph-stats">
      {cards.map((card) => (
        <Link key={card.id} href={card.href} className="cph-stat" data-stat={card.id} data-state={card.state}>
          <span className="cph-stat-label">{card.label}</span>
          <span className="cph-stat-value">{card.value === null ? "—" : card.value}</span>
          <span className="cph-stat-note">{card.note}</span>
        </Link>
      ))}
    </div>
  );
}
