import ReviewPage from "@/app/dashboard/review/page";
import { state } from "../state";
import { ORG, resetState, session } from "../fixtures";
import type { FirmSession } from "@/lib/firm/session";
import type { Screen } from "../registry";

/**
 * The weekly review in the TECHNICIAN view (the firm has no `role-views` switch). Only the page content is drawn, inside the
 * bare content wrappers, so the same screen can be rendered on origin/main and on a branch and the two compared pixel for pixel.
 */
const tech = (query: Record<string, string>) =>
  async function renderTech() {
    const live = session as Extract<FirmSession, { kind: "ok" }>;
    const before = live.org;
    (live as { org: typeof ORG }).org = { ...ORG, modules: ORG.modules.filter((m) => m !== "role-views") };
    try {
      const page = await ReviewPage({ searchParams: Promise.resolve(query) });
      return (
        <div className="lx-app">
          <div className="lx-main">
            <div className="lx-content">
              <div className="lx-page">{page}</div>
            </div>
          </div>
        </div>
      );
    } finally {
      live.org = before;
    }
  };
const prepare = () => {
  resetState();
  state.pathname = "/dashboard/review/";
};

const base = { designBoard: "ReviewBoard", pathname: "/dashboard/review/", shell: "none" as const, prepare };

export const screens: Screen[] = [
  { ...base, id: "review-tech-board", title: "Weekly review, Board (technician)", viewport: "desktop", render: tech({}) },
  { ...base, id: "review-tech-board-phone", title: "Weekly review, Board (technician, phone)", viewport: "phone", render: tech({}) },
  { ...base, id: "review-tech-sheet", title: "Weekly review, Sheet (technician)", viewport: "desktop", render: tech({ view: "sheet" }) },
  { ...base, id: "review-tech-cards", title: "Weekly review, Cards (technician)", viewport: "desktop", render: tech({ view: "cards" }) },
];
