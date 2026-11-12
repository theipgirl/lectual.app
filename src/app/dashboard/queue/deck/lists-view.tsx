import { redirect } from "next/navigation";
import { resolveFirmSession } from "@/lib/firm/session";
import { loadActiveQueue } from "@/lib/queue/load";
import { loadApprovalRouting } from "@/lib/queue/routing-load";
import { loadCardState } from "@/lib/queue/card-state";
import { getFirmTimeZone } from "@/lib/org/profile";
import { listMemberDirectory } from "@/lib/members/directory";
import { buildDeck, DECK_BASE, type CardState } from "@/lib/queue/deck";
import { dealtAt } from "@/lib/deal/times";
import { classifyQueueItem, kindShort } from "@/lib/queue/routing";
import { agentLabel } from "@/components/queue/format";
import { DeckLists } from "@/components/deck/DeckLists";
import { decidableIds, decidedSource, eventSources, handedRows, laterBackPill, laterRows, makeListFormat, type ListParam } from "@/lib/queue/deck-lists";

/**
 * `/dashboard/queue/deck/?list=decided|handed|later`. The caller has already passed the deck's gate (role-views on, a
 * signed-in firm member), so this only reads. Each source is read and judged on its own: a failing one is named on its own
 * card and the others still draw.
 */
export async function DeckListsView({ list }: { list: ListParam }) {
  if (list === "need") redirect(DECK_BASE);
  const session = await resolveFirmSession().catch(() => null);
  if (!session || session.kind !== "ok") return null;
  const viewer = { userId: session.user.id, role: session.role };

  const [pending, approved, rejected, tz, directory, routed] = await Promise.all([
    loadActiveQueue("pending"),
    loadActiveQueue("approved"),
    loadActiveQueue("rejected"),
    getFirmTimeZone(),
    listMemberDirectory().catch(() => null),
    loadApprovalRouting(),
  ]);
  const now = new Date();
  const fmt = makeListFormat(now, tz);
  const pendingItems = pending.status === "ok" ? pending.items : [];
  const cardState: CardState | null = pending.status === "ok" ? await loadCardState(pendingItems.map((i) => i.id)) : null;

  const members = directory ?? [];
  const firstNameOf = (id: string) => {
    const m = members.find((x) => x.userId === id);
    const full = m?.displayName?.trim() || m?.email?.trim() || "";
    return full.split(/[\s@]/)[0] || "a teammate";
  };

  const events = cardState?.status === "ok" ? cardState.events : [];
  const decided = decidedSource(approved, rejected, session.user.email ?? null, fmt);
  const routing = routed.status === "ok" ? routed.routing : {};
  const decidable = decidableIds(pendingItems, routing, viewer);
  const { handed, later } = eventSources({
    pendingStatus: pending.status,
    cardState,
    handed: () => handedRows(pendingItems, events, viewer.userId, firstNameOf, fmt, decidable),
    later: () => laterRows(pendingItems, events, viewer.userId, now, decidable, (i) => `${agentLabel(i.agent)} · ${kindShort(classifyQueueItem(i))}`, (until) => laterBackPill(until, now, tz)),
  });

  let needCount: number | null = null;
  if (pending.status === "ok") {
    const deck = buildDeck({ items: pendingItems, routing, viewer, cardState: cardState ?? { status: "unavailable" }, now, dealtAt: dealtAt(now, tz) });
    needCount = deck.cards.length;
  }

  return <DeckLists active={list} needCount={needCount} decided={decided} handed={handed} later={later} />;
}
