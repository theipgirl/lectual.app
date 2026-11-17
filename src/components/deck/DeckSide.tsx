import Link from "next/link";
import {
  DECK_COL_DECIDED,
  DECK_COL_LATER,
  DECK_COL_NEEDS_YES,
  DECK_SIDE_CANT,
  DECK_SIDE_CANT_DECIDED,
  DECK_SIDE_LATER_CANT,
  DECK_SIDE_LATER_NOTHING,
  DECK_SIDE_NOTHING_DECIDED,
  DECK_SIDE_NOTHING_LEFT,
  DECK_SIDE_SEE_ALL,
  DECK_SIDE_SEE_ALL_DECIDED_LABEL,
  DECK_SIDE_SEE_ALL_LATER_LABEL,
  DECK_SIDE_TITLE,
  NOT_SWITCHED_ON,
} from "@/lib/ui/words";
import { listHref } from "@/lib/queue/deck-lists";
import type { ChipTone } from "./deck-rows";

export type DeckSideRow = { id: string; /** The chip is a bare time ("2:00 PM"): it never wraps. */ timeChip?: boolean; title: string; href: string; current: boolean; decided: boolean; sub?: string; chip?: string; tone?: ChipTone };

/** The viewer's own Later cards, in the same three states every read here has. */
export type DeckSideLater = { status: "ok"; rows: DeckSideRow[] } | { status: "not-set-up" } | { status: "unavailable" };

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
      {r.chip && <span className={`dk-chip dk-chip--${r.tone ?? "warn"}${r.timeChip ? " dk-chip--time" : ""}`}>{r.chip}</span>}
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

function Card({ label, count, children }: { label: string; count: string | number; children: React.ReactNode }) {
  return (
    <section className="dk-sidecard" aria-label={label}>
      <div className="dk-sidecard-head">
        <h2>{label}</h2>
        <span className="dk-sub-mono">{count}</span>
      </div>
      {children}
    </section>
  );
}

/** "All your approvals": three card sections, Needs your yes, Later, Decided today. */
export function DeckSide({ rows, failed, note, later, decidedFailed }: { rows: DeckSideRow[]; failed?: boolean; /** The approved / rejected lists could not be read: Decided is a dash and a sentence, never 0. */ decidedFailed?: boolean; note?: string | null; later?: DeckSideLater }) {
  const need = rows.filter((r) => !r.decided);
  const done = rows.filter((r) => r.decided);
  const noDecided = failed || decidedFailed;
  return (
    <nav className="dk-sidestack" aria-label={DECK_SIDE_TITLE}>
      {note && <p className="dk-side-note dk-side-note--card">{note}</p>}
      <Card label={DECK_COL_NEEDS_YES} count={failed ? "—" : need.length}>
        {failed ? <p className="dk-side-note dk-side-note--risk">{DECK_SIDE_CANT}</p> : need.length === 0 ? <p className="dk-empty-card">{DECK_SIDE_NOTHING_LEFT}</p> : (
          <ol className="dk-side-rows">
            {need.map((r) => (
              <Row key={r.id} r={r} />
            ))}
          </ol>
        )}
      </Card>
      {later && (
        <Card label={DECK_COL_LATER} count={later.status === "ok" ? later.rows.length : "—"}>
          {later.status === "ok" ? (
            later.rows.length === 0 ? (
              <p className="dk-empty-card">{DECK_SIDE_LATER_NOTHING}</p>
            ) : (
              <>
                <ol className="dk-side-rows">
                  {later.rows.map((r) => (
                    <Row key={r.id} r={r} />
                  ))}
                </ol>
                <Link href={listHref("later")} className="dk-side-more" aria-label={DECK_SIDE_SEE_ALL_LATER_LABEL}>
                  {DECK_SIDE_SEE_ALL}
                </Link>
              </>
            )
          ) : (
            <p className={`dk-side-note${later.status === "unavailable" ? " dk-side-note--risk" : ""}`}>{later.status === "not-set-up" ? NOT_SWITCHED_ON : DECK_SIDE_LATER_CANT}</p>
          )}
        </Card>
      )}
      <Card label={DECK_COL_DECIDED} count={noDecided ? "—" : done.length}>
        {noDecided ? <p className="dk-side-note dk-side-note--risk">{DECK_SIDE_CANT_DECIDED}</p> : done.length === 0 ? <p className="dk-empty-card">{DECK_SIDE_NOTHING_DECIDED}</p> : (
          <>
            <ol className="dk-side-rows">
              {done.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </ol>
            <Link href={listHref("decided")} className="dk-side-more" aria-label={DECK_SIDE_SEE_ALL_DECIDED_LABEL}>
              {DECK_SIDE_SEE_ALL}
            </Link>
          </>
        )}
      </Card>
    </nav>
  );
}
