import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { orgHasModule } from "@/lib/org/modules";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadActiveQueue } from "@/lib/queue/load";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { loadCardState } from "@/lib/queue/card-state";
import { loadAuditContext } from "@/lib/queue/audit-context";
import { checkDraftStaleness, stalenessRequiresConfirm } from "@/lib/queue/stale";
import { gateLinkedProposal } from "@/lib/consult-proposal/link";
import { getFirmTimeZone } from "@/lib/org/profile";
import { listMemberDirectory, type MemberIdentity } from "@/lib/members/directory";
import { QUEUE_EDIT_ROLES } from "@/lib/queue/roles";
import { whenLabel, dealFor, dealtAt, sameFirmDay } from "@/lib/deal/times";
import {
  buildDeck,
  decidedToday,
  deckEmptyState,
  deckHref,
  draftOpening,
  parseAtParam,
  parseDeckView,
  positionOf,
  type CloserLookFlags,
  type Deck,
  type DeckCard,
} from "@/lib/queue/deck";
import type { QueueItem } from "@/lib/queue/api";
import { DeckFrame, type DeckSideRow } from "@/components/deck/DeckFrame";
import { ApprovalCard } from "@/components/deck/ApprovalCard";
import { DeckKeys } from "@/components/review/DeckKeys";
import { QueueUnavailable } from "@/components/queue/QueueUnavailable";
import { agentLabel, fmtWhen } from "@/components/queue/format";
import { pageTitle } from "@/lib/ui/page-title";
import { DECK_ROUTING_UNREAD,
  DECK_COL_DECIDED,
  DECK_COL_HANDED_OFF,
  DECK_COL_LATER,
  DECK_COL_NEEDS_YES,
  DECK_DEALT_NOW,
  DECK_DECIDED_UNREAD,
  DECK_EVENTS_UNREAD,
  DECK_NOTHING_HERE,
  DECK_TAG_INTERNAL,
  DECK_TITLE,
  NOT_SWITCHED_ON,
  dealHeader,
  deckSource,
  deckTagYes,
  nextDealHeader,
} from "@/lib/ui/words";

export const metadata: Metadata = { title: pageTitle(DECK_TITLE) };

/** How many dealt cards get the server-side closer-look checks (stale draft, linked proposal) per render. */
const FLAG_CHECK_LIMIT = 30;

type Search = { view?: string | string[]; at?: string | string[]; deal?: string | string[] };

function memberName(m: MemberIdentity | undefined): string {
  return m?.displayName?.trim() || m?.email?.trim() || "a teammate";
}

/** Closer-look facts that need a read: a draft whose client moved on, and a proposal-link gate. A failed check counts as yes. */
async function closerLookFlags(items: readonly QueueItem[]): Promise<Record<string, CloserLookFlags>> {
  const out: Record<string, CloserLookFlags> = {};
  await Promise.all(
    items.slice(0, FLAG_CHECK_LIMIT).map(async (item) => {
      const [stale, gate] = await Promise.all([
        checkDraftStaleness(item).then(stalenessRequiresConfirm, () => true),
        gateLinkedProposal(item.id).then((g) => !g.ok, () => true),
      ]);
      out[item.id] = { stale, linkedProposal: gate };
    }),
  );
  // Beyond the limit nothing was checked, so those cards go to the full page rather than offering a Yes.
  for (const item of items.slice(FLAG_CHECK_LIMIT)) out[item.id] = { stale: true };
  return out;
}

function tagText(card: DeckCard): string {
  return card.tag.kind === "internal" ? DECK_TAG_INTERNAL : deckTagYes(card.tag.minutes);
}

export default async function DeckPage({ searchParams }: { searchParams: Promise<Search> }) {
  if (!(await orgHasModule("role-views"))) notFound();
  const session = await resolveFirmSession().catch(() => null);
  if (!session || session.kind !== "ok") notFound();

  const params = await searchParams;
  const view = parseDeckView(params.view);
  const at = parseAtParam(params.at);
  const dealNow = (Array.isArray(params.deal) ? params.deal[0] : params.deal) === "now";
  const viewer = { userId: session.user.id, role: session.role };

  const [load, tz] = await Promise.all([loadActiveQueue("pending"), getFirmTimeZone()]);
  const now = new Date();
  const deal = dealFor(now, tz);
  const dealLine = dealNow ? DECK_DEALT_NOW : deal.current ? dealHeader(deal.current.label) : nextDealHeader(deal.next.label);
  const viewHref = (v: typeof view) => deckHref({ view: v, dealNow });

  if (load.status !== "ok") {
    return (
      <DeckFrame dealLine={dealLine} view={view} viewHref={viewHref} side={null} laterArrivals={0} nextDealLabel={deal.next.label} dealNowHref={deckHref({ view, dealNow: true })}>
        <QueueUnavailable status={load.status} reason={load.reason} />
      </DeckFrame>
    );
  }

  const [routed, cardState, audit, directory, approved, rejected] = await Promise.all([
    loadApprovalRouting(),
    loadCardState(load.items.map((i) => i.id)),
    loadAuditContext(),
    listMemberDirectory().catch(() => null),
    loadActiveQueue("approved"),
    loadActiveQueue("rejected"),
  ]);
  const routing = routed.status === "ok" ? routed.routing : {};
  const base = { items: load.items, routing, viewer, cardState, now, dealtAt: dealNow ? null : dealtAt(now, tz), audit };
  const first = buildDeck(base);
  const deck: Deck = buildDeck({ ...base, flags: await closerLookFlags(first.cards.map((c) => c.item)) });

  const decidedReadable = approved.status === "ok" && rejected.status === "ok";
  const decided = decidedReadable ? decidedToday([...approved.items, ...rejected.items], session.user.email ?? null, (d) => sameFirmDay(d, now, tz)) : [];

  const members = directory ?? [];
  const nameOf = (id: string) => memberName(members.find((m) => m.userId === id));
  const people = members
    .filter((m) => m.userId !== viewer.userId && QUEUE_EDIT_ROLES.includes(m.role))
    .map((m) => ({ userId: m.userId, name: memberName(m) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const movesUnavailable = cardState.status === "not-set-up" ? NOT_SWITCHED_ON : cardState.status === "unavailable" ? DECK_EVENTS_UNREAD : null;
  const canEdit = QUEUE_EDIT_ROLES.includes(viewer.role);

  const frame = (side: DeckSideRow[] | null, children: React.ReactNode) => (
    <DeckFrame
      dealLine={dealLine}
      view={view}
      viewHref={viewHref}
      side={side}
      sideNote={!decidedReadable ? DECK_DECIDED_UNREAD : cardState.status === "unavailable" ? DECK_EVENTS_UNREAD : null}
      laterArrivals={deck.laterArrivals.length}
      nextDealLabel={deal.next.label}
      dealNowHref={deckHref({ view, dealNow: true })}
    >
      {routed.status !== "ok" && (
        <p role="status" className="lx-note" style={{ margin: "0 0 12px" }}>
          {DECK_ROUTING_UNREAD}
        </p>
      )}
      {children}
    </DeckFrame>
  );

  if (view === "list") return frame(null, <DeckList deck={deck} decided={decided} decidedReadable={decidedReadable} tz={tz} nameOf={nameOf} />);
  if (view === "board") return frame(null, <DeckBoard deck={deck} decided={decided} decidedReadable={decidedReadable} nameOf={nameOf} eventsNote={movesUnavailable} />);

  const pos = positionOf(deck.cards, at);
  const side: DeckSideRow[] = [
    ...deck.cards.map((c) => ({ id: c.item.id, title: c.item.headline, href: deckHref({ at: c.item.id, dealNow }), current: pos?.card.item.id === c.item.id, decided: false })),
    ...decided.map((i) => ({ id: `done-${i.id}`, title: i.headline, href: `/dashboard/queue/${encodeURIComponent(i.id)}/`, current: false, decided: true })),
  ];

  if (!pos) {
    const onDeck = new Set([...deck.cards, ...deck.laterArrivals, ...deck.later, ...deck.handedOff].map((c) => c.item.id));
    const othersPending = load.items.filter((i) => i.status === "pending" && !onDeck.has(i.id)).length;
    // A Later can run past the next deal (set after the last one of the day): name the day it comes back.
    const firstBack = deck.later.map((c) => Date.parse(c.until)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    const laterBackLabel = firstBack === undefined ? undefined : whenLabel(new Date(firstBack), now, tz);
    const empty = deckEmptyState({ queueOk: true, role: viewer.role, deck, nextDealLabel: deal.next.label, othersPending, laterBackLabel });
    return frame(
      side,
      <div className="lx-card lx-empty-card" role="status">
        <h2 className="lx-h2" style={{ fontSize: 25 }}>
          {"headline" in empty ? empty.headline : null}
        </h2>
        {"details" in empty && empty.details.length > 0 && (
          <p className="lx-note" style={{ margin: "8px 0 0" }}>
            {empty.details.join(" ")}
          </p>
        )}
      </div>,
    );
  }

  const card = pos.card;
  const holderName = card.handedToMe ? nameOf(card.handedToMe.by) : null;
  return frame(
    side,
    <>
      <DeckKeys />
      <ApprovalCard
        key={card.item.id}
        id={card.item.id}
        source={deckSource(agentLabel(card.item.agent))}
        tag={tagText(card)}
        title={card.item.headline}
        recipient={card.item.recipient}
        opening={draftOpening(card.item)}
        firstStep={card.firstStep}
        checkFirst={card.checkFirst}
        position={pos.position}
        total={pos.total}
        prevHref={pos.prevId ? deckHref({ at: pos.prevId, dealNow }) : null}
        nextHref={pos.nextId ? deckHref({ at: pos.nextId, dealNow }) : null}
        afterHref={deckHref({ at: pos.nextId, dealNow })}
        internal={card.tag.kind === "internal"}
        canYes={card.canYes}
        closerLook={card.closerLook.length > 0}
        handedByName={holderName}
        handNote={card.handedToMe?.note ?? null}
        handedToMe={!!card.handedToMe}
        canMove={card.canYes || !!card.handedToMe}
        movesUnavailable={movesUnavailable}
        people={people}
        review={{ initialBody: card.item.final_body ?? card.item.draft_body, canApprove: card.canYes, canEdit, audit: { type: card.item.type, ...audit } }}
      />
    </>,
  );
}

function itemLink(item: QueueItem) {
  return <Link href={`/dashboard/queue/${encodeURIComponent(item.id)}/`}>{item.headline}</Link>;
}

function DeckList({ deck, decided, decidedReadable, tz, nameOf }: { deck: Deck; decided: QueueItem[]; decidedReadable: boolean; tz: string; nameOf: (id: string) => string }) {
  const rows: Array<{ item: QueueItem; state: string }> = [
    ...deck.cards.map((c) => ({ item: c.item, state: c.tag.kind === "internal" ? DECK_TAG_INTERNAL : DECK_COL_NEEDS_YES })),
    ...deck.laterArrivals.map((c) => ({ item: c.item, state: "Next deal" })),
    ...deck.later.map((c) => ({ item: c.item, state: DECK_COL_LATER })),
    ...deck.handedOff.map((c) => ({ item: c.item, state: `${DECK_COL_HANDED_OFF} · ${nameOf(c.holder.userId)}` })),
    ...decided.map((i) => ({ item: i, state: DECK_COL_DECIDED })),
  ];
  return (
    <>
      {!decidedReadable && (
        <p role="status" className="lx-note" style={{ margin: 0 }}>
          {DECK_DECIDED_UNREAD}
        </p>
      )}
      {rows.length === 0 ? (
        <div className="lx-card lx-empty-card">
          <p className="lx-note" style={{ margin: 0 }}>
            {DECK_NOTHING_HERE}
          </p>
        </div>
      ) : (
        <div className="lx-card" style={{ overflow: "auto" }}>
          <table className="lx-tbl lx-stack">
            <thead>
              <tr>
                <th>Draft</th>
                <th>Client</th>
                <th>Where</th>
                <th>Queued</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, state }) => (
                <tr key={`${state}-${item.id}`}>
                  <td className="wrap pri">{itemLink(item)}</td>
                  <td data-label="Client">{item.client_name ?? "—"}</td>
                  <td data-label="Where">{state}</td>
                  <td className="lx-num" data-label="Queued">
                    {fmtWhen(item.created_at, tz)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Column({ title, items, note }: { title: string; items: Array<{ item: QueueItem; extra?: string }>; note?: string | null }) {
  return (
    <section className="lx-card dk-col" aria-label={title}>
      <h2 className="lx-label">
        {title} ({note ? "—" : items.length})
      </h2>
      {note ? (
        <p className="lx-note" style={{ margin: 0 }}>
          {note}
        </p>
      ) : items.length === 0 ? (
        <p className="lx-note" style={{ margin: 0 }}>
          {DECK_NOTHING_HERE}
        </p>
      ) : (
        <ul>
          {items.map(({ item, extra }) => (
            <li key={item.id}>
              {itemLink(item)}
              {extra ? <div className="lx-note">{extra}</div> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DeckBoard({
  deck,
  decided,
  decidedReadable,
  nameOf,
  eventsNote,
}: {
  deck: Deck;
  decided: QueueItem[];
  decidedReadable: boolean;
  nameOf: (id: string) => string;
  /** Why Handed off and Later can't be shown: not switched on yet, or couldn't be read. */
  eventsNote: string | null;
}) {
  return (
    <div className="dk-board">
      <Column title={DECK_COL_NEEDS_YES} items={deck.cards.map((c) => ({ item: c.item, extra: c.handedToMe ? `From ${nameOf(c.handedToMe.by)}` : undefined }))} />
      <Column title={DECK_COL_HANDED_OFF} note={eventsNote} items={deck.handedOff.map((c) => ({ item: c.item, extra: `With ${nameOf(c.holder.userId)}` }))} />
      <Column title={DECK_COL_LATER} note={eventsNote} items={deck.later.map((c) => ({ item: c.item }))} />
      <Column title={DECK_COL_DECIDED} note={decidedReadable ? null : DECK_DECIDED_UNREAD} items={decided.map((i) => ({ item: i, extra: i.status === "approved" ? "Approved" : "Rejected" }))} />
    </div>
  );
}
