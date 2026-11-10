import { OwnerToday } from "@/components/today/OwnerToday";
import { state } from "../state";
import { NOW, OWNER_ID, proposals, resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

const today = () => (
  <OwnerShell>
    <OwnerToday userId={OWNER_ID} role="owner" email="rebecca@rpb.example" metadata={{ full_name: "Rebecca Ames" }} now={NOW} />
  </OwnerShell>
);

export const screens: Screen[] = [
  {
    id: "today-desktop",
    title: "Owner Today, desktop",
    designBoard: "Main",
    viewport: "desktop",
    pathname: "/dashboard/",
    prepare: () => {
      resetState();
      state.pathname = "/dashboard/";
      state.proposals = proposals.map((p, i) => ({ ...p, title: p.title.split(" \u00b7 ")[0], opens: i === 0 ? 2 : 0 }));
    },
    render: today,
    // The real shell scrolls inside .lx-page (rail and top bar fixed). For a full-page capture only, unfold it.
    transformHtml: (html) => "<style>.lx-app{height:auto!important;overflow:visible!important}.lx-content,.lx-page{overflow:visible!important}</style>" + html,
    note: "Real OwnerToday (async server component) with the loaders mocked in setup.ts.",
  },
  {
    id: "today-phone",
    title: "Owner Today, phone",
    designBoard: "PhoneToday",
    viewport: "phone",
    // Left phone ("03 Simple Today") of the 1000x960 board. Tune with the README's crop recipe.
    designCrop: [40, 61, 375, 812],
    pathname: "/dashboard/",
    prepare: () => {
      resetState();
      state.pathname = "/dashboard/";
      state.proposals = proposals.map((p, i) => ({ ...p, title: p.title.split(" \u00b7 ")[0], opens: i === 0 ? 2 : 0 }));
    },
    render: today,
    note: "Same page at 375px; the rail hides and MobileBar shows.",
  },
];
