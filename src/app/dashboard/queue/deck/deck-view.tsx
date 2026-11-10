import { notFound } from "next/navigation";
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
  deckMinutes,
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
import { ApprovalCard, type ApprovalCardProps } from "@/components/deck/ApprovalCard";
import { DeckBoard, DeckList, type BoardColumn } from "@/components/deck/DeckList";
import { DeckClean, DeckEmpty, DeckUnavailable } from "@/components/deck/DeckStates";
import { queuedLabel, waitingText, ageText, type BoardCard, type ListRow } from "@/components/deck/deck-rows";
import { classifyQueueItem, kindRowWord, kindShort } from "@/lib/queue/routing";
import { roleLabel } from "@/lib/auth/roles";
import { DeckKeys } from "@/components/review/DeckKeys";
import { agentLabel } from "@/components/queue/format";
import {
  DECK_BADGE_INTERNAL,
  DECK_BADGE_REVIEW,
  DECK_BADGE_YES,
  DECK_BOARD_SUB,
  DECK_CHIP_APPROVED,
  DECK_CHIP_NOW,
  DECK_CHIP_REJECTED,
  DECK_CHIP_SKIPPED,
  DECK_CHIP_WAITING,
  DECK_META_ALL_DECIDED,
  DECK_META_CANT_SHOW,
  DECK_META_NOT_CONNECTED,
  DECK_OPEN_TO_REVIEW,
  DECK_ST_NEXT_DEAL,
  DECK_ST_WAITING,
  deckDecidedAt,
  deckLeft,
  deckListSub,
  deckWaitingBack,
  deckWaitingTo,
  DECK_ROUTING_UNREAD,
  DECK_COL_DECIDED,
  DECK_COL_HANDED_OFF,
  DECK_COL_LATER,
  DECK_COL_NEEDS_YES,
  DECK_DEALT_NOW,
  DECK_DECIDED_UNREAD,
  DECK_EVENTS_UNREAD,
  DECK_NOTHING_HERE,
  DECK_TAG_INTERNAL,
  NOT_SWITCHED_ON,
  dealHeader,
  deckSource,
  deckTagYes,
  nextDealHeader,
} from "@/lib/ui/words";

/** How many dealt cards get the server-side closer-look checks (stale draft, linked proposal) per render. */
const FLAG_CHECK_LIMIT = 30;

export type DeckInitial = Pick<NonNullable<ApprovalCardProps["initial"]>, "mode" | "holding" | "result" | "note">;
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

const roleName = (m: MemberIdentity) => `${memberName(m)} · ${roleLabel(m.role)}`;

export async function DeckView({ searchParams, initial }: { searchParams: Promise<Search>; initial?: DeckInitial }) {
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
  const dealNowHref = deckHref({ view, dealNow: true });

  if (load.status !== "ok") {
    return (
      <DeckFrame
        dealLine={dealLine}
        view={view}
        viewHref={viewHref}
        side={[]}
        sideFailed
        meta={load.status === "unconfigured" ? DECK_META_NOT_CONNECTED : DECK_META_CANT_SHOW}
        laterArrivals={0}
        nextDealLabel={deal.next.label}
        dealLabel={deal.current?.label ?? null}
        dealNowHref={dealNowHref}
        wideSub={view === "board" ? DECK_BOARD_SUB : undefined}
      >
        <DeckUnavailable status={load.status} reason={load.reason} />
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
    .map((m) => ({ userId: m.userId, name: roleName(m) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const movesUnavailable = cardState.status === "not-set-up" ? NOT_SWITCHED_ON : cardState.status === "unavailable" ? DECK_EVENTS_UNREAD : null;
  const canEdit = QUEUE_EDIT_ROLES.includes(viewer.role);
  const dealLabel = deal.current?.label ?? null;

  const waiting = deck.cards.length + deck.laterArrivals.length + deck.later.length;
  const frameProps = {
    dealLine,
    view,
    viewHref,
    sideNote: !decidedReadable ? DECK_DECIDED_UNREAD : cardState.status === "unavailable" ? DECK_EVENTS_UNREAD : null,
    laterArrivals: deck.laterArrivals.length,
    nextDealLabel: deal.next.label,
    dealLabel,
    dealNowHref,
  };
  const frame = (side: DeckSideRow[] | null, meta: string | null, children: React.ReactNode, wideSub?: string) => (
    <DeckFrame {...frameProps} side={side} meta={meta} wideSub={wideSub}>
      {routed.status !== "ok" && (
        <p role="status" className="lx-note" style={{ margin: 0 }}>
          {DECK_ROUTING_UNREAD}
        </p>
      )}
      {children}
    </DeckFrame>
  );

  const statusOf = (c: DeckCard): { label: string; tone: ListRow["statusTone"] } =>
    c.closerLook.length > 0 && c.canYes ? { label: DECK_OPEN_TO_REVIEW, tone: "ox" } : c.tag.kind === "internal" ? { label: DECK_ST_WAITING, tone: "warn" } : { label: DECK_COL_NEEDS_YES, tone: "warn" };

  if (view === "list") {
    const row = (item: QueueItem, deal: string, status: { label: string; tone: ListRow["statusTone"] }): ListRow => ({
      id: item.id,
      href: `/dashboard/queue/${encodeURIComponent(item.id)}/`,
      title: item.headline,
      kind: kindShort(classifyQueueItem(item)),
      to: item.client_name,
      from: agentLabel(item.agent),
      queued: queuedLabel(item.created_at, now, tz),
      deal,
      statusLabel: status.label,
      statusTone: status.tone,
      waiting: waitingText(item.created_at, now),
    });
    const dealAt = deal.current?.label ?? deal.next.label;
    const rows: ListRow[] = [
      ...deck.cards.map((c) => row(c.item, dealAt, statusOf(c))),
      ...deck.laterArrivals.map((c) => row(c.item, deal.next.label, { label: DECK_ST_NEXT_DEAL, tone: "line" })),
      ...deck.later.map((c) => row(c.item, deal.next.label, { label: DECK_COL_LATER, tone: "line" })),
      ...deck.handedOff.map((c) => row(c.item, "—", { label: `${DECK_COL_HANDED_OFF} · ${nameOf(c.holder.userId)}`, tone: "line" })),
      ...decided.map((i) => row(i, "—", i.status === "approved" ? { label: DECK_CHIP_APPROVED, tone: "ok" } : { label: DECK_CHIP_REJECTED, tone: "risk" })),
    ];
    return frame(null, null, <DeckList rows={rows} decidedReadable={decidedReadable} />, deckListSub(waiting, deck.cards.length, deck.laterArrivals.length, dealLabel ?? deal.next.label));
  }
  if (view === "board") {
    const card = (item: QueueItem, badge: string, badgeTone: BoardCard["badgeTone"], sub: string): BoardCard => ({
      id: item.id,
      href: `/dashboard/queue/${encodeURIComponent(item.id)}/`,
      kind: kindShort(classifyQueueItem(item)),
      forName: item.client_name,
      badge,
      badgeTone,
      title: item.headline,
      sub,
    });
    const columns: BoardColumn[] = [
      {
        title: DECK_COL_NEEDS_YES,
        empty: DECK_NOTHING_HERE,
        cards: deck.cards.map((c) => {
          const [badge, tone]: [string, BoardCard["badgeTone"]] = c.tag.kind === "internal" ? [DECK_BADGE_INTERNAL, "plain"] : c.closerLook.length > 0 && c.canYes ? [DECK_BADGE_REVIEW, "ox"] : [DECK_BADGE_YES, "warn"];
          return card(c.item, badge, tone, c.handedToMe ? `From ${nameOf(c.handedToMe.by)}` : waitingText(c.item.created_at, now));
        }),
      },
      {
        title: DECK_COL_HANDED_OFF,
        empty: DECK_NOTHING_HERE,
        note: movesUnavailable,
        cards: deck.handedOff.map((c) => card(c.item, nameOf(c.holder.userId), "line", deckWaitingTo(nameOf(c.holder.userId), ageText(c.holder.at, now)))),
      },
      {
        title: DECK_COL_LATER,
        empty: DECK_NOTHING_HERE,
        note: movesUnavailable,
        cards: deck.later.map((c) => card(c.item, deal.next.label, "line", deckWaitingBack(deal.next.label))),
      },
      {
        title: DECK_COL_DECIDED,
        empty: DECK_NOTHING_HERE,
        note: decidedReadable ? null : DECK_DECIDED_UNREAD,
        cards: decided.map((i) => card(i, i.status === "approved" ? DECK_CHIP_APPROVED : DECK_CHIP_REJECTED, i.status === "approved" ? "ok" : "risk", deckDecidedAt(i.status === "approved" ? "approved" : "rejected", queuedLabel(i.resolved_at, now, tz), i.status !== "approved" && !!i.resolution_note))),
      },
    ];
    return frame(null, null, <DeckBoard columns={columns} />, DECK_BOARD_SUB);
  }

  const pos = positionOf(deck.cards, at);
  const decidedRows: DeckSideRow[] = decided.map((i) => ({
    id: `done-${i.id}`,
    title: i.headline,
    sub: deckDecidedAt(i.status === "approved" ? "approved" : "rejected", queuedLabel(i.resolved_at, now, tz), i.status !== "approved" && !!i.resolution_note).replace(/^./, (c) => c.toUpperCase()),
    href: `/dashboard/queue/${encodeURIComponent(i.id)}/`,
    current: false,
    decided: true,
    chip: i.status === "approved" ? DECK_CHIP_APPROVED : DECK_CHIP_REJECTED,
    tone: i.status === "approved" ? "ok" : "crit",
  }));
  const side: DeckSideRow[] = [
    ...deck.cards.map((c, idx) => {
      const index = pos?.index ?? 0;
      const now_ = idx === index;
      return {
        id: c.item.id,
        title: c.item.headline,
        sub: `${agentLabel(c.item.agent)} · ${kindRowWord(c.kind)}`,
        href: deckHref({ at: c.item.id, dealNow }),
        current: now_,
        decided: false,
        chip: now_ ? DECK_CHIP_NOW : idx < index ? DECK_CHIP_SKIPPED : DECK_CHIP_WAITING,
        tone: (now_ ? "accent" : idx < index ? "quiet" : "warn") as DeckSideRow["tone"],
      };
    }),
    ...decidedRows,
  ];

  if (!pos) {
    const onDeck = new Set([...deck.cards, ...deck.laterArrivals, ...deck.later, ...deck.handedOff].map((c) => c.item.id));
    const othersPending = load.items.filter((i) => i.status === "pending" && !onDeck.has(i.id)).length;
    // A Later can run past the next deal (set after the last one of the day): name the day it comes back.
    const firstBack = deck.later.map((c) => Date.parse(c.until)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    const laterBackLabel = firstBack === undefined ? undefined : whenLabel(new Date(firstBack), now, tz);
    const empty = deckEmptyState({ queueOk: true, role: viewer.role, deck, nextDealLabel: deal.next.label, othersPending, laterBackLabel });
    const allDone = empty.kind === "all-decided";
    return frame(
      side,
      allDone ? DECK_META_ALL_DECIDED : deckLeft(0, 0),
      allDone ? (
        <DeckClean headline={empty.headline} approved={decided.filter((i) => i.status === "approved").length} rejected={decided.filter((i) => i.status !== "approved").length} waiting={0} />
      ) : (
        <DeckEmpty headline={"headline" in empty ? empty.headline : ""} details={"details" in empty ? empty.details : []} />
      ),
    );
  }

  const card = pos.card;
  const holderName = card.handedToMe ? nameOf(card.handedToMe.by) : null;
  return frame(
    side,
    deckLeft(deck.cards.length, deckMinutes(deck.cards)),
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
        initial={initial}
      />
    </>,
  );
}
