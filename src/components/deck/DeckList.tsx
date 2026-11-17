import Link from "next/link";
import { LoadFailedLine } from "@/components/ui/LoadFailed";
import { Pill } from "@/components/ui/Pill";
import { SheetCard, SheetScroll, SheetTable } from "@/components/ui/SheetTable";
import { BLANK, DECK_DECIDED_UNREAD, DECK_FOR, DECK_LIST_EMPTY } from "@/lib/ui/words";
import { chipPillTone, type BoardCard, type ListRow } from "./deck-rows";

/** Everything waiting, as a table (a stack of cards on a phone: the sheet table kit's own phone rule). */
export function DeckList({ rows, decidedReadable }: { rows: ListRow[]; decidedReadable: boolean }) {
  return (
    <>
      {!decidedReadable && <LoadFailedLine refresh={false}>{DECK_DECIDED_UNREAD}</LoadFailedLine>}
      {rows.length === 0 ? (
        <div className="lx-card lx-state-card">
          <p className="lx-note">{DECK_LIST_EMPTY}</p>
        </div>
      ) : (
        <SheetCard>
          <SheetScroll>
            <SheetTable className="dk-tbl">
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
                    <td className="pri">
                      <Link href={r.href}>{r.title}</Link>
                    </td>
                    <td data-label="Kind">{r.kind}</td>
                    <td data-label="To">{r.to ?? BLANK}</td>
                    <td data-label="From">{r.from}</td>
                    <td data-label="Queued">{r.queued}</td>
                    <td data-label="Deal">{r.deal}</td>
                    <td data-label="Status">
                      <Pill tone={chipPillTone(r.statusTone === "plain" ? "quiet" : r.statusTone === "risk" ? "crit" : r.statusTone === "ox" ? "accent" : r.statusTone)}>{r.statusLabel}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </SheetTable>
          </SheetScroll>
        </SheetCard>
      )}
    </>
  );
}

export type BoardColumn = { title: string; cards: BoardCard[]; note?: string | null; empty: string };

/** Every approval by where it stands. No drag: each move is a button on the card. */
export function DeckBoard({ columns }: { columns: BoardColumn[] }) {
  return (
    <div className="dk-board">
      {columns.map((c) => (
        <section key={c.title} className="lx-board-col dk-col" aria-label={c.title}>
          <header>
            <h2 className="lx-board-title">{c.title}</h2>
            <span className="lx-board-count">{c.note ? BLANK : c.cards.length}</span>
          </header>
          {c.note ? (
            <p className="lx-note">{c.note}</p>
          ) : c.cards.length === 0 ? (
            <p className="lx-board-empty">{c.empty}</p>
          ) : (
            c.cards.map((card) => (
              <Link key={card.id} href={card.href} className="lx-board-card dk-boardcard" data-tone={card.badgeTone === "risk" ? "risk" : card.badgeTone === "warn" ? "warn" : "mute"}>
                <span className="lx-board-card-top">
                  <span className="lx-board-card-title">{card.title}</span>
                  <Pill tone={chipPillTone(card.badgeTone === "plain" ? "quiet" : card.badgeTone === "risk" ? "crit" : card.badgeTone === "ox" ? "accent" : card.badgeTone)}>{card.badge}</Pill>
                </span>
                <span className="lx-board-card-meta">
                  {card.kind}
                  {card.forName ? ` · ${DECK_FOR} ${card.forName}` : ""}
                </span>
                <span className="lx-board-card-step">{card.sub}</span>
              </Link>
            ))
          )}
        </section>
      ))}
    </div>
  );
}
