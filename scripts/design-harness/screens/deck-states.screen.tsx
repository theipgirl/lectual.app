import { DeckView, type DeckInitial } from "@/app/dashboard/queue/deck/deck-view";
import { state } from "../state";
import { resetState, queueItem, pending, approved } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

type Opts = { view?: "cards" | "list" | "board"; at?: string; initial?: DeckInitial; setup?: () => void };
const mk = (id: string, title: string, designBoard: string, o: Opts, phone = false, crop?: [number, number, number, number]): Screen => ({
  id,
  title,
  designBoard,
  viewport: phone ? "phone" : "desktop",
  designCrop: crop,
  pathname: "/dashboard/queue/deck/",
  prepare: () => {
    resetState();
    state.pathname = "/dashboard/queue/deck/";
    (state as { queueStatus?: string }).queueStatus = undefined;
    o.setup?.();
  },
  render: async () => <OwnerShell>{await DeckView({ searchParams: Promise.resolve({ view: o.view ?? "cards", ...(o.at ? { at: o.at } : {}) }), initial: o.initial })}</OwnerShell>,
});
const ph = (board: string, n: number): [number, number, number, number] => [40 + 415 * (n - 1), 61, 375, 812];
const unreach = () => ((state as { queueStatus?: string }).queueStatus = "unavailable");
const notconn = () => ((state as { queueStatus?: string }).queueStatus = "unconfigured");
const allDone = () => {
  state.pending = [];
  state.approved = approved;
};
const withArrivals = () => {
  state.pending = [...pending, queueItem({ id: "qa", headline: "Reply to Theo Grant about BRIGHTLINE", created_at: "2026-11-10T14:50:00Z" })];
};

export const screens: Screen[] = [
  mk("deck-open", "Deck, Open to review", "DeckOpen", { at: "q2" }),
  mk("deck-briefing", "Deck, internal briefing", "DeckBriefing", { at: "q3" }),
  mk("deck-hold", "Deck, 5-second hold", "DeckHold", { initial: { holding: 5 } }),
  mk("deck-after", "Deck, after approve", "DeckAfter", {
    initial: { result: { ok: true, message: "Approved.", draft: { provider: "microsoft", webLink: "https://outlook.example/draft", draftId: "d1", canSend: true, sendNote: null } } },
  }),
  mk("deck-reject", "Deck, reject sheet", "DeckReject", { initial: { mode: "rejecting", note: "Wrong package. Maya chose Essential on the call, not Enhanced." } }),
  mk("deck-clean", "Deck, clean slate", "DeckClean", { setup: allDone }),
  mk("deck-later", "Deck, later arrivals", "DeckLater", { setup: withArrivals }),
  mk("deck-unreach", "Deck, unreachable", "DeckUnreach", { setup: unreach }),
  mk("deck-notconn", "Deck, not connected", "DeckUnreach", { setup: notconn }),
  mk("deck-handoff", "Deck, hand off", "P2Handoff", { initial: { mode: "handing" } }),
  mk("deck-later-done", "Deck, Later done", "P2Later", { initial: { result: { ok: true, message: "Put off until the next deal." } } }),
  mk("deck-lists", "Deck, board (lists)", "P2Lists", { view: "board" }),
  mk("deck-mycards", "Deck, handed to me", "P2MyCards", {}),
  mk("deck-phone-open", "Phone deck, open to review", "PhoneDeckA", { at: "q2" }, true, ph("A", 2)),
  mk("deck-phone-briefing", "Phone deck, briefing", "PhoneDeckA", { at: "q3" }, true, ph("A", 3)),
  mk("deck-phone-hold", "Phone deck, hold", "PhoneDeckA", { initial: { holding: 5 } }, true, ph("A", 4)),
  mk("deck-phone-after", "Phone deck, after", "PhoneDeckB", { initial: { result: { ok: true, message: "Approved.", draft: { provider: "microsoft", webLink: null, draftId: "d1", canSend: true, sendNote: null } } } }, true, ph("B", 1)),
  mk("deck-phone-reject", "Phone deck, reject", "PhoneDeckB", { initial: { mode: "rejecting", note: "Wrong package." } }, true, ph("B", 2)),
  mk("deck-phone-clean", "Phone deck, clean", "PhoneDeckB", { setup: allDone }, true, ph("B", 3)),
  mk("deck-phone-later", "Phone deck, later", "PhoneDeckB", { setup: withArrivals }, true, ph("B", 4)),
  mk("deck-phone-unreach", "Phone deck, unreachable", "PhoneDeckC", { setup: unreach }, true, ph("C", 1)),
  mk("deck-phone-notconn", "Phone deck, not connected", "PhoneDeckC", { setup: notconn }, true, ph("C", 2)),
  mk("deck-phone-list", "Phone deck, list", "PhoneDeckC", { view: "list" }, true, ph("C", 3)),
  mk("deck-phone-handoff", "Phone deck, hand off", "PhoneP2", { initial: { mode: "handing" } }, true, ph("P", 1)),
];
