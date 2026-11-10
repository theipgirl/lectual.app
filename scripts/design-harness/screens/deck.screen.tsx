import DeckPage from "@/app/dashboard/queue/deck/page";
import { state } from "../state";
import { resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

const deck = (view: "cards" | "list" | "board", at?: string) =>
  async function renderDeck() {
    const page = await DeckPage({ searchParams: Promise.resolve({ view, ...(at ? { at } : {}) }) });
    return <OwnerShell>{page}</OwnerShell>;
  };
const prepare = () => {
  resetState();
  (state as { queueStatus?: string }).queueStatus = undefined;
  state.pathname = "/dashboard/queue/deck/";
};

export const screens: Screen[] = [
  {
    id: "deck-cards",
    title: "Approval deck, Cards (one-tap Yes)",
    designBoard: "DeckYes",
    viewport: "desktop",
    pathname: "/dashboard/queue/deck/",
    prepare,
    render: deck("cards", "q1"),
    note: "Real DeckPage (async) with queue/routing/card-state loaders mocked.",
  },
  {
    id: "deck-cards-phone",
    title: "Approval deck, Cards, phone",
    designBoard: "PhoneDeckA",
    viewport: "phone",
    designCrop: [40, 61, 375, 812],
    pathname: "/dashboard/queue/deck/",
    prepare,
    render: deck("cards", "q1"),
  },
  {
    id: "deck-list",
    title: "Approval deck, List (See all)",
    designBoard: "SeeAll",
    viewport: "desktop",
    pathname: "/dashboard/queue/deck/",
    prepare,
    render: deck("list"),
  },
  {
    id: "deck-board",
    title: "Approval deck, Board",
    designBoard: "ApprovalsBoard",
    viewport: "desktop",
    pathname: "/dashboard/queue/deck/",
    prepare,
    render: deck("board"),
  },
];
