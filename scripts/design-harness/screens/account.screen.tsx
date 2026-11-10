import { OwnerToday } from "@/components/today/OwnerToday";
import { state } from "../state";
import { NOW, OWNER_ID, resetState } from "../fixtures";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";

export const screens: Screen[] = [
  {
    id: "account-menu",
    title: "Account menu, open",
    designBoard: "AccountMenu",
    viewport: "desktop",
    pathname: "/dashboard/",
    prepare: () => {
      resetState();
      state.pathname = "/dashboard/";
    },
    render: () => (
      <OwnerShell>
        <OwnerToday userId={OWNER_ID} role="owner" email="rebecca@rpb.example" metadata={{ full_name: "Rebecca Ames" }} now={NOW} />
      </OwnerShell>
    ),
    // The menu is a <details>; the server markup has no open attribute, so add it.
    transformHtml: (html) => html.replace(/<details style="position:relative">/, '<details open="" style="position:relative">'),
    note: "Real AccountMenu inside the owner shell, forced open by transformHtml.",
  },
];
