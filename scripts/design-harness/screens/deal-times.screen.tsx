import DeckPage from "@/app/dashboard/queue/deck/page";
import { DealTimesDialogView } from "@/components/deck/DealTimesDialog";
import { state } from "../state";
import { resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

const noop = () => {};
const prepare = () => {
  resetState();
  (state as { queueStatus?: string }).queueStatus = undefined;
  state.pathname = "/dashboard/queue/deck/";
};
const render = async () => {
  const page = await DeckPage({ searchParams: Promise.resolve({ view: "cards", at: "q1" }) });
  return (
    <OwnerShell>
      {page}
      <DealTimesDialogView first="07:00" second="14:00" zoneLabel="Eastern Time (New York)" error={null} saving={false} onFirst={noop} onSecond={noop} onSave={noop} onClose={noop} />
    </OwnerShell>
  );
};

// No design board exists for this dialog (it follows the Your name dialog's pattern), so the pair's left side is the deck board.
export const screens: Screen[] = [
  {
    id: "deal-times-dialog",
    title: "Deal times dialog over the deck",
    designBoard: "DeckYes",
    viewport: "desktop",
    pathname: "/dashboard/queue/deck/",
    prepare,
    render,
    note: "Real DealTimesDialogView over the real deck page; the Change deal times link is in the deck header behind it.",
  },
  {
    id: "deal-times-dialog-phone",
    title: "Deal times dialog over the deck, phone",
    designBoard: "PhoneDeckA",
    viewport: "phone",
    designCrop: [40, 61, 375, 812],
    pathname: "/dashboard/queue/deck/",
    prepare,
    render,
  },
];
