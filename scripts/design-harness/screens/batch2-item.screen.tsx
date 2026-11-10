import Link from "next/link";
import { ReviewPanel } from "@/components/queue/ReviewPanel";
import { DeckView } from "@/app/dashboard/queue/deck/deck-view";
import QueueItemPage from "@/app/dashboard/queue/[id]/page";
import { state } from "../state";
import { resetState, queueItem, pending } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

const ph = (n: number): [number, number, number, number] => [40 + 415 * (n - 1), 61, 375, 812];
const sam = queueItem({
  id: "q2",
  headline: "Follow up with Sam Lee about LUMEN TEA",
  agent: "morning-brief",
  type: "CLIENT_EMAIL",
  client_name: "Sam Lee · LUMEN TEA",
  recipient: "sam@lumentea.example",
  subject: "Your opinion letter questions",
  draft_body: "Hi Sam,\n\nJust checking in on the questions we sent last week about your opinion letter for LUMEN TEA. When you have a moment, a reply would help us move your filing forward.\n\nBest,\nRebecca",
  summary: "CHECK FIRST: Sam replied Nov 9. Read it before deciding.\nOpinion letter was sent Nov 3.\nNo proposal is open.\nLast call was Oct 28.",
  created_at: "2026-11-08T11:58:00Z",
});
const stale = {
  status: "stale" as const,
  leadIds: ["l1"],
  leadName: "Sam",
  linkedBy: "draft" as const,
  facts: [{ reason: "client", at: "2026-11-09T21:12:00Z" }],
};

const mk = (id: string, title: string, board: string, n: number, extra: () => void = () => {}, phone = true): Screen => ({
  id,
  title,
  designBoard: board,
  viewport: phone ? "phone" : "desktop",
  designCrop: phone ? ph(n) : undefined,
  pathname: "/dashboard/queue/q2/",
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/queue/q2/";
    state.pending = [sam, ...pending.filter((p) => p.id !== "q2")];
    (state as { itemStale?: unknown }).itemStale = undefined;
    extra();
  },
  render: async () => <OwnerShell>{await QueueItemPage({ params: Promise.resolve({ id: "q2" }), searchParams: Promise.resolve({}) })}</OwnerShell>,
});

export const screens: Screen[] = [
  mk("item-phone", "Item page, phone", "PhoneItem", 1),
  mk("item-desktop", "Item page, desktop", "Main", 1, () => {}, false),
  mk("item-phone-stale", "Item page, stale, phone", "PhoneItem", 3, () => ((state as { itemStale?: unknown }).itemStale = stale)),
];

/** 05b: the editor open. The page cannot start in edit mode, so the same pieces are laid out the way the page does. */
screens.push({
  id: "item-phone-edit",
  title: "Item page, editing, phone",
  designBoard: "PhoneItem",
  viewport: "phone",
  designCrop: ph(2),
  pathname: "/dashboard/queue/q2/",
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/queue/q2/";
  },
  render: () => (
    <OwnerShell>
      <Link href="/dashboard/queue/" className="lx-back lx-qi-back">
        ← Approvals
      </Link>
      <div className="lx-split lx-qi">
        <div className="lx-col">
          <div>
            <div className="lx-label lx-qi-kind">Client email · Morning brief</div>
            <h1 className="lx-h1">{sam.headline}</h1>
          </div>
          <section className="lx-card lx-qi-card">
            <ReviewPanel id="q2" initialBody={sam.draft_body} canApprove canEdit startEditing />
          </section>
        </div>
      </div>
    </OwnerShell>
  ),
});

screens.push({
  id: "deck-phone-later-done",
  title: "Phone deck, Later done",
  designBoard: "PhoneP2",
  viewport: "phone",
  designCrop: ph(2),
  pathname: "/dashboard/queue/deck/",
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/queue/deck/";
  },
  render: async () => (
    <OwnerShell>
      {await DeckView({ searchParams: Promise.resolve({ view: "cards" }), initial: { result: { ok: true, message: "Put off until the next deal." } } })}
    </OwnerShell>
  ),
});

/* Batch 2, P2: the deck with people's hand-offs and Later in force. */
const A2 = "00000000-0000-4000-8000-0000000000a2";
const A3 = "00000000-0000-4000-8000-0000000000a3";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const deckScreen = (id: string, title: string, board: string, view: "cards" | "board", setup: () => void): Screen => ({
  id,
  title,
  designBoard: board,
  viewport: "desktop",
  pathname: "/dashboard/queue/deck/",
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/queue/deck/";
    setup();
  },
  render: async () => <OwnerShell>{await DeckView({ searchParams: Promise.resolve({ view }) })}</OwnerShell>,
});
screens.push(
  deckScreen("deck-mycards-handed", "Deck, a card handed to me", "P2MyCards", "cards", () => {
    state.cardState = {
      status: "ok",
      events: [{ queueItemId: "q1", kind: "handoff", actorId: A2, targetUserId: OWNER, until: null, note: "Check the class descriptions against the consult notes, then send it back to me.", createdAt: "2026-11-10T13:20:00Z" }],
    };
  }),
  deckScreen("deck-lists-full", "Deck board, hand-offs, Later and decided", "P2Lists", "board", () => {
    state.cardState = {
      status: "ok",
      events: [
        { queueItemId: "q4", kind: "handoff", actorId: OWNER, targetUserId: A3, until: null, note: "Check the class descriptions.", createdAt: "2026-11-10T12:24:00Z" },
        { queueItemId: "q5", kind: "later", actorId: OWNER, targetUserId: null, until: "2026-11-10T19:00:00Z", note: null, createdAt: "2026-11-10T13:00:00Z" },
      ],
    };
    state.rejected = [queueItem({ id: "q8", headline: "Follow up with Sam Lee about LUMEN TEA", status: "rejected", resolved_by: "rebecca@rpb.example", resolved_at: "2026-11-10T12:20:00Z", resolution_note: "Answers an older email. Redo after Sam's Nov 9 reply." })];
  }),
);
