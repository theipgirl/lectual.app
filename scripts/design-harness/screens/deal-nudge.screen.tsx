import { OwnerToday } from "@/components/today/OwnerToday";
import { dealReadyLine } from "@/lib/ui/words";
import { state } from "../state";
import { NOW, OWNER_ID, resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

/** Phase 2 item 4: the deal-ready nudge. The sample clock is 9:30 AM Eastern, so the 7:00 AM deal is current. */
const READY = dealReadyLine("7:00 AM", 6);
const today = () => <OwnerToday userId={OWNER_ID} role="owner" email="rebecca@rpb.example" metadata={{ full_name: "Rebecca Ames" }} now={NOW} />;
const prepare = () => {
  resetState();
  state.pathname = "/dashboard/";
};

export const screens: Screen[] = [
  {
    id: "nudge-today-desktop",
    title: "Deal-ready nudge: Today tile and rail dot, desktop",
    designBoard: "Main",
    viewport: "desktop",
    pathname: "/dashboard/",
    prepare,
    render: () => <OwnerShell dealReady={READY}>{today()}</OwnerShell>,
    transformHtml: (html) => "<style>.lx-app{height:auto!important;overflow:visible!important}.lx-content,.lx-page{overflow:visible!important}</style>" + html,
    note: "Real OwnerToday (tile line) in the owner shell with the Approvals rail dot. No board draws the nudge: compare against Main for layout only.",
  },
  {
    id: "nudge-today-phone",
    title: "Deal-ready nudge: Today tile and phone bar dot, phone",
    designBoard: "PhoneToday",
    viewport: "phone",
    designCrop: [40, 61, 375, 812],
    pathname: "/dashboard/",
    prepare,
    render: () => <OwnerShell dealReady={READY}>{today()}</OwnerShell>,
    note: "Same at 375px: the tile line above the count and the dot on the phone bar's Approvals item.",
  },
  {
    id: "nudge-rail-collapsed",
    title: "Deal-ready nudge: rail collapsed",
    designBoard: "TodayCollapsed",
    viewport: "desktop",
    pathname: "/dashboard/",
    prepare,
    render: () => (
      <OwnerShell railPinned={false} dealReady={READY}>
        {today()}
      </OwnerShell>
    ),
    note: "Collapsed rail: the dot sits beside the Approvals icon row.",
  },
];
