import Link from "next/link";
import "./deck.css";
import {
  APPROVALS_NAME,
  DECK_COL_DECIDED,
  DECK_COL_HANDED_OFF,
  DECK_COL_LATER,
  DECK_COL_NEEDS_YES,
  DECK_DECIDED_UNREAD,
  DECK_LISTS_BACK,
  DECK_LISTS_CHIP_DECIDED,
  DECK_LISTS_HANDOFF_NOTE,
  DECK_LISTS_NAV,
  DECK_LISTS_SUB,
  DECK_LIST_HANDED_CANT,
  DECK_LIST_HANDED_EMPTY,
  DECK_LIST_LATER_CANT,
  DECK_LIST_LATER_EMPTY,
  DECK_SIDE_NOTHING_DECIDED,
  NOT_SWITCHED_ON,
  deckListChip,
} from "@/lib/ui/words";
import { DECK_BASE } from "@/lib/queue/deck";
import { listHref, sourceCount, type DecidedRow, type HandedRow, type LaterRow, type ListParam, type ListSource } from "@/lib/queue/deck-lists";

type Tone = "ok" | "crit" | "line" | "warn" | "accent";

function ListCard<T extends { id: string }>({ title, source, empty, cant, render, foot }: { title: string; source: ListSource<T>; empty: string; cant: string; render: (r: T) => React.ReactNode; foot?: string }) {
  return (
    <section className="dk-lcard" aria-label={title}>
      <div className="dk-sidecard-head">
        <h2>{title}</h2>
        <span className="dk-sub-mono">{sourceCount(source)}</span>
      </div>
      {source.status === "ok" ? (
        source.rows.length === 0 ? (
          <p className="dk-empty-card">{empty}</p>
        ) : (
          <ol className="dk-side-rows">{source.rows.map((r) => <li key={r.id}>{render(r)}</li>)}</ol>
        )
      ) : (
        <p className={`dk-side-note${source.status === "unavailable" ? " dk-side-note--risk" : ""}`} role={source.status === "unavailable" ? "status" : undefined}>
          {source.status === "not-set-up" ? NOT_SWITCHED_ON : cant}
        </p>
      )}
      {foot && <p className="dk-lfoot">{foot}</p>}
    </section>
  );
}

function Row({ href, title, sub, pill, tone }: { href: string; title: string; sub: string; pill: string; tone: Tone }) {
  return (
    <Link href={href} className="dk-side-row dk-lrow">
      <span className="dk-side-main">
        <span className="dk-side-title">{title}</span>
        <span className="dk-side-sub">{sub}</span>
      </span>
      <span className={`dk-chip dk-chip--${tone}`}>{pill}</span>
    </Link>
  );
}

/**
 * Board 17: "Decided today" and "Handed off" as two cards. The chip group names the lists; the active one is
 * aria-current. Each source carries its own state, so one failing never empties another.
 */
export function DeckLists({
  active,
  needCount,
  decided,
  handed,
  later,
}: {
  active: ListParam;
  /** Cards dealt now, or null when the pending list could not be read. */
  needCount: number | null;
  decided: ListSource<DecidedRow>;
  handed: ListSource<HandedRow>;
  later: ListSource<LaterRow>;
}) {
  const chips: Array<{ key: ListParam; label: string; count: string; href: string }> = [
    { key: "need", label: DECK_COL_NEEDS_YES, count: needCount === null ? "—" : String(needCount), href: DECK_BASE },
    { key: "decided", label: DECK_LISTS_CHIP_DECIDED, count: sourceCount(decided), href: listHref("decided") },
    { key: "handed", label: DECK_COL_HANDED_OFF, count: sourceCount(handed), href: listHref("handed") },
    { key: "later", label: DECK_COL_LATER, count: sourceCount(later), href: listHref("later") },
  ];
  const showGrid = active !== "later";
  return (
    <div className="dk-frame dk-frame--wide dk-lists">
      <div className="dk-wide-head">
        <Link href={DECK_BASE} className="dk-back">
          {DECK_LISTS_BACK}
        </Link>
        <h1 className="dk-h1 dk-h1--wide">{APPROVALS_NAME}</h1>
        <p className="dk-sub">{DECK_LISTS_SUB}</p>
      </div>
      <nav className="dk-chips" aria-label={DECK_LISTS_NAV}>
        {chips.map((c) => (
          <Link key={c.key} href={c.href} className="dk-lchip" aria-current={c.key === active ? "page" : undefined}>
            {deckListChip(c.label, c.count)}
          </Link>
        ))}
      </nav>
      {showGrid ? (
        <div className="dk-lgrid">
          <ListCard title={DECK_COL_DECIDED} source={decided} empty={DECK_SIDE_NOTHING_DECIDED} cant={DECK_DECIDED_UNREAD} render={(r) => <Row href={r.href} title={r.title} sub={r.sub} pill={r.pill} tone={r.tone} />} />
          <ListCard
            title={DECK_COL_HANDED_OFF}
            source={handed}
            empty={DECK_LIST_HANDED_EMPTY}
            cant={DECK_LIST_HANDED_CANT}
            render={(r) => <Row href={r.href} title={r.title} sub={r.sub} pill={r.pill} tone={r.tone} />}
            foot={DECK_LISTS_HANDOFF_NOTE}
          />
        </div>
      ) : (
        <div className="dk-lgrid dk-lgrid--one">
          <ListCard title={DECK_COL_LATER} source={later} empty={DECK_LIST_LATER_EMPTY} cant={DECK_LIST_LATER_CANT} render={(r) => <Row href={r.href} title={r.title} sub={r.kind} pill={r.pill} tone="line" />} />
        </div>
      )}
    </div>
  );
}
