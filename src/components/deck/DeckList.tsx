import Link from "next/link";
import { DECK_DECIDED_UNREAD, DECK_FOR, DECK_LIST_FOOT, DECK_NOTHING_HERE } from "@/lib/ui/words";
import type { BoardCard, ListRow } from "./deck-rows";

/** Everything waiting, as a table (a stack of cards on a phone). */
export function DeckList({ rows, decidedReadable }: { rows: ListRow[]; decidedReadable: boolean }) {
  return (
    <>
      {!decidedReadable && (
        <p role="status" className="dk-side-note dk-side-note--risk" style={{ padding: 0 }}>
          {DECK_DECIDED_UNREAD}
        </p>
      )}
      {rows.length === 0 ? (
        <div className="dk-empty">
          <p style={{ margin: 0 }}>{DECK_NOTHING_HERE}</p>
        </div>
      ) : (
        <>
          <div className="dk-tablecard">
            <table className="dk-tbl">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Kind</th>
                  <th>To</th>
                  <th>From</th>
                  <th>Queued</th>
                  <th>Deal</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.statusLabel}-${r.id}`}>
                    <td>
                      <Link href={r.href}>{r.title}</Link>
                    </td>
                    <td>{r.kind}</td>
                    <td>{r.to ?? "—"}</td>
                    <td>{r.from}</td>
                    <td className="dk-mono">{r.queued}</td>
                    <td>{r.deal}</td>
                    <td>
                      <span className={`dk-pill ${r.statusTone === "plain" ? "" : `dk-pill--${r.statusTone}`}`.trim()}>{r.statusLabel}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="dk-lcards">
            {rows.map((r) => (
              <li key={`c-${r.statusLabel}-${r.id}`}>
                <Link href={r.href} className="dk-lcard">
                  <span className="dk-lcard-top">
                    <span className="dk-kind">
                      {r.kind}
                      {r.to ? ` · ${DECK_FOR} ${r.to}` : ""}
                    </span>
                    <span className={`dk-pill ${r.statusTone === "plain" ? "" : `dk-pill--${r.statusTone}`}`.trim()}>{r.statusLabel}</span>
                  </span>
                  <span className="dk-lcard-title">{r.title}</span>
                  <span className="dk-lcard-sub">{r.waiting}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="dk-foot-note">{DECK_LIST_FOOT}</p>
    </>
  );
}

export type BoardColumn = { title: string; cards: BoardCard[]; note?: string | null; empty: string };

/** Every approval by where it stands. No drag: each move is a button on the card. */
export function DeckBoard({ columns }: { columns: BoardColumn[] }) {
  return (
    <div className="dk-board">
      {columns.map((c) => (
        <section key={c.title} className="dk-col" aria-label={c.title}>
          <div className="dk-col-head">
            <h2>{c.title}</h2>
            <span className="dk-sub-mono">{c.note ? "—" : c.cards.length}</span>
          </div>
          {c.note ? (
            <p className="dk-col-note">{c.note}</p>
          ) : c.cards.length === 0 ? (
            <p className="dk-col-empty">{c.empty}</p>
          ) : (
            c.cards.map((card) => (
              <Link key={card.id} href={card.href} className="dk-lcard">
                <span className="dk-lcard-top">
                  <span className="dk-kind">
                    {card.kind}
                    {card.forName ? ` · ${DECK_FOR} ${card.forName}` : ""}
                  </span>
                  <span className={`dk-pill ${card.badgeTone === "plain" ? "" : `dk-pill--${card.badgeTone}`}`.trim()}>{card.badge}</span>
                </span>
                <span className="dk-lcard-title">{card.title}</span>
                <span className="dk-lcard-sub">{card.sub}</span>
              </Link>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
