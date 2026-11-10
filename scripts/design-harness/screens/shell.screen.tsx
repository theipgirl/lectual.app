import { OwnerToday } from "@/components/today/OwnerToday";
import { state } from "../state";
import { NOW, OWNER_ID, resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

const today = () => <OwnerToday userId={OWNER_ID} role="owner" email="rebecca@rpb.example" metadata={{ full_name: "Rebecca Ames" }} now={NOW} />;
const prepare = () => {
  resetState();
  state.pathname = "/dashboard/";
};

export const screens: Screen[] = [
  {
    id: "shell-rail-collapsed",
    title: "Shell: rail collapsed, More menu open",
    designBoard: "TodayCollapsed",
    viewport: "desktop",
    pathname: "/dashboard/",
    prepare,
    render: () => (
      <OwnerShell railPinned={false} railFlyout>
        {today()}
      </OwnerShell>
    ),
    note: "Real Rail unpinned with the More menu forced open (initialFlyout). Compare the left 420x500 only.",
  },
  {
    id: "shell-phone-more",
    title: "Shell: phone More sheet open",
    designBoard: "PhoneToday",
    viewport: "phone",
    designCrop: [475, 61, 375, 812],
    pathname: "/dashboard/",
    prepare,
    render: () => <OwnerShell moreOpen>{today()}</OwnerShell>,
    note: "Real MobileBar with the More sheet forced open (initialOpen).",
  },
];
