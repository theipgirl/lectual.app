import type { ReactNode } from "react";
import ReviewPage from "@/app/dashboard/review/page";
import { visibleNav } from "@/lib/nav";
import { drawnNav, shellFor } from "@/lib/views";
import { Rail } from "@/components/shell/Rail";
import { MobileBar } from "@/components/shell/MobileBar";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { FirmWordmark } from "@/components/shell/FirmWordmark";
import { BellPopover } from "@/components/notifications/BellPopover";
import { state } from "../state";
import { ORG, MODULES, resetState, session } from "../fixtures";
import type { FirmSession } from "@/lib/firm/session";
import type { Screen } from "../registry";

/**
 * The TECHNICIAN shell (no `.lx-top--owner`, default rail and phone bar) around the technician weekly review, so the legibility pass
 * can prove, pixel for pixel against an older commit, that no owner-only rule reaches the technician view. Not a design-board screen.
 */
function TechShell({ children, railPinned = true }: { children: ReactNode; railPinned?: boolean }) {
  const items = visibleNav(MODULES, "owner");
  const shell = shellFor("technician");
  const drawn = drawnNav(items, "technician");
  return (
    <div className="lx-app">
      <header className="lx-top">
        <div className="lx-wordmark" title={ORG.name}>
          <FirmWordmark org={ORG} />
        </div>
        <div style={{ flex: 1 }} />
        <BellPopover count={{ status: "ok", unread: 3 }} list={{ status: "ok", rows: [] }} />
        <AccountMenu initials="RA" name="Rebecca Ames" email="rebecca@rpb.example" role="owner" firmName={ORG.name} activeOrgId={ORG.id} switchableFirms={[]} settingsInMenu={shell.settingsInMenu} variant={shell.variant} />
      </header>
      <div className="lx-main">
        <Rail items={drawn} queueStatus="ok" pendingCount={6} counts={{}} initialPinned={railPinned} showSettings={shell.showSettings} showReports={shell.showReports} tree={shell.tree} variant={shell.variant} />
        <div className="lx-content">
          <div className="lx-page">{children}</div>
        </div>
      </div>
      <MobileBar items={drawn} queueStatus="ok" pendingCount={6} counts={{}} bar={shell.bar} groups={shell.moreGroups} variant={shell.variant} />
    </div>
  );
}

const tech = (query: Record<string, string>, pinned = true) =>
  async function renderTech() {
    const live = session as Extract<FirmSession, { kind: "ok" }>;
    const before = live.org;
    (live as { org: typeof ORG }).org = { ...ORG, modules: ORG.modules.filter((m) => m !== "role-views") };
    try {
      return <TechShell railPinned={pinned}>{await ReviewPage({ searchParams: Promise.resolve(query) })}</TechShell>;
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
  { ...base, id: "tech-shell-desktop", title: "Technician shell, weekly review board", viewport: "desktop", render: tech({}) },
  { ...base, id: "tech-shell-collapsed", title: "Technician shell, rail collapsed", viewport: "desktop", render: tech({}, false) },
  { ...base, id: "tech-shell-phone", title: "Technician shell, phone", viewport: "phone", render: tech({}) },
  { ...base, id: "tech-shell-sheet", title: "Technician shell, weekly review sheet", viewport: "desktop", render: tech({ view: "sheet" }) },
];
