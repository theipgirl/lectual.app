import { state } from "../state";
import { resetState } from "../fixtures";
import { NeedsReviewCard } from "@/components/today/NeedsReviewCard";
import { OwnerShell } from "../shell";
import type { Screen } from "../registry";
import { needsReviewSample } from "../fixtures";

/**
 * The technician Today page needs ~15 loaders; the new card is the only addition, so this screen draws the real card
 * in the technician card style (lx-card / lx-band) on the shell.
 */
export const screens: Screen[] = [
  {
    id: "today-tech",
    title: "Technician Today, Needs review card",
    designBoard: "Main",
    viewport: "desktop",
    pathname: "/dashboard/",
    prepare: () => {
      resetState();
      state.pathname = "/dashboard/";
    },
    render: async () => (
      <OwnerShell>
        <div style={{ maxWidth: 720 }}>
          <NeedsReviewCard items={needsReviewSample} />
        </div>
      </OwnerShell>
    ),
    transformHtml: (html) => "<style>.lx-app{height:auto!important;overflow:visible!important}.lx-content,.lx-page{overflow:visible!important}</style>" + html,
    note: "Card only (the page's other loaders are not mocked).",
  },
];
