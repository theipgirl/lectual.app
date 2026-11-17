import type { ReactNode } from "react";
import { visibleNav } from "@/lib/nav";
import { drawnNav, NO_PREVIEW, shellFor, viewMenuFor } from "@/lib/views";
import { Rail } from "@/components/shell/Rail";
import { MobileBar } from "@/components/shell/MobileBar";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { FirmWordmark } from "@/components/shell/FirmWordmark";
import { BellPopover } from "@/components/notifications/BellPopover";
import { ORG, MODULES, OWNER_ID } from "./fixtures";

/**
 * The owner shell exactly as src/app/dashboard/layout.tsx draws it (header, Rail, content, MobileBar), built from the
 * same functions (visibleNav -> drawnNav -> shellFor) with sample data. If the layout changes, mirror it here.
 */
export function OwnerShell({ children, pendingCount = 6, railPinned = true, railFlyout = false, moreOpen = false, dealReady = null }: { children: ReactNode; pendingCount?: number; railPinned?: boolean; railFlyout?: boolean; moreOpen?: boolean; dealReady?: string | null }) {
  const items = visibleNav(MODULES, "owner");
  const shell = shellFor("owner");
  const drawn = drawnNav(items, "owner");
  // A firm owner: no view switch (only Lectual staff acting in a firm get one).
  const viewMenu = viewMenuFor({ preview: NO_PREVIEW, firmHasRoleViews: true, actingAsStaff: false });
  return (
    <div className="lx-app">
      <header className="lx-top lx-top--owner">
        <div className="lx-wordmark" title={ORG.name}>
          <FirmWordmark org={ORG} />
        </div>
        <div style={{ flex: 1 }} />
        <BellPopover count={{ status: "ok", unread: 3 }} list={{ status: "ok", rows: [] }} />
        <AccountMenu
          initials="RA"
          name="Rebecca Ames"
          email="rebecca@rpb.example"
          role="owner"
          firmName={ORG.name}
          activeOrgId={ORG.id}
          switchableFirms={[]}
          viewMenu={viewMenu}
          settingsInMenu={shell.settingsInMenu}
          variant={shell.variant}
        />
      </header>
      <div className="lx-main">
        <Rail
          items={drawn}
          queueStatus="ok"
          pendingCount={pendingCount}
          counts={{}}
          initialPinned={railPinned}
          initialFlyout={railFlyout}
          dealReady={dealReady}
          showSettings={shell.showSettings}
          showReports={shell.showReports}
          tree={shell.tree}
          variant={shell.variant}
        />
        <div className="lx-content">
          <div className="lx-page">{children}</div>
        </div>
      </div>
      <MobileBar items={drawn} queueStatus="ok" pendingCount={pendingCount} counts={{}} bar={shell.bar} groups={shell.moreGroups} variant={shell.variant} initialOpen={moreOpen} dealReady={dealReady} />
    </div>
  );
}

export { OWNER_ID };
