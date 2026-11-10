import Link from "next/link";
import { DECK_COL_DECIDED, DECK_SIDE_CANT, DECK_SIDE_CANT_DECIDED, DECK_SIDE_NOTHING_DECIDED, DECK_SIDE_NOTHING_LEFT, DECK_SIDE_TITLE, deckSideCounts } from "@/lib/ui/words";
import type { ChipTone } from "./deck-rows";

export type DeckSideRow = { id: string; title: string; href: string; current: boolean; decided: boolean; sub?: string; chip?: string; tone?: ChipTone };

function Row({ r }: { r: DeckSideRow }) {
  const body = (
    <>
      {r.decided && (
        <span className="dk-tick" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24">
            <path d="M5 12l5 5 9-10" />
          </svg>
        </span>
      )}
      <span className="dk-side-main">
        <span className="dk-side-title">{r.title}</span>
        {r.sub && <span className="dk-side-sub">{r.sub}</span>}
      </span>
      {r.chip && <span className={`dk-chip dk-chip--${r.tone ?? "warn"}`}>{r.chip}</span>}
    </>
  );
  return (
    <li>
      <Link href={r.href} className="dk-side-row" aria-current={r.current ? "true" : undefined}>
        {body}
      </Link>
    </li>
  );
}

/** "All your approvals": one scrolling list, status words, then "Decided today". */
export function DeckSide({ rows, failed, note }: { rows: DeckSideRow[]; failed?: boolean; note?: string | null }) {
  const need = rows.filter((r) => !r.decided);
  const done = rows.filter((r) => r.decided);
  return (
    <nav className="dk-sidecard" aria-label={DECK_SIDE_TITLE}>
      <div className="dk-sidecard-head">
        <h2>{DECK_SIDE_TITLE}</h2>
        <span className="dk-sub-mono">{deckSideCounts(failed ? "—" : String(need.length), failed ? "—" : String(done.length))}</span>
      </div>
      <div className="dk-side-scroll">
        {note && <p className="dk-side-note">{note}</p>}
        {failed ? <p className="dk-side-note dk-side-note--risk">{DECK_SIDE_CANT}</p> : need.length === 0 ? <p className="dk-side-note">{DECK_SIDE_NOTHING_LEFT}</p> : (
          <ol className="dk-side-rows">
            {need.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ol>
        )}
        <div className="dk-sep">
          <span>{DECK_COL_DECIDED}</span>
          <span>{failed ? "—" : done.length}</span>
        </div>
        {failed ? <p className="dk-side-note dk-side-note--risk">{DECK_SIDE_CANT_DECIDED}</p> : done.length === 0 ? <p className="dk-side-note">{DECK_SIDE_NOTHING_DECIDED}</p> : (
          <ol className="dk-side-rows">
            {done.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ol>
        )}
      </div>
    </nav>
  );
}
