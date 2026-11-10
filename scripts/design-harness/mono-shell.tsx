import type { ReactNode } from "react";
import { visibleNav } from "@/lib/nav";
import { drawnNav, shellFor } from "@/lib/views";
import { Rail } from "@/components/shell/Rail";
import { MobileBar } from "@/components/shell/MobileBar";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { FirmWordmark } from "@/components/shell/FirmWordmark";
import { SectionLabel } from "@/components/shell/SectionLabel";
import { BellPopover } from "@/components/notifications/BellPopover";
import { ORG, MODULES } from "./fixtures";

/**
 * The TECHNICIAN shell as src/app/dashboard/layout.tsx draws it for a firm member whose view is the technician one
 * (the firm has no `role-views`, or the role is not the owner): light header with the section label, the full rail, the phone bar.
 */
export function TechShell({ children, pendingCount = 6 }: { children: ReactNode; pendingCount?: number }) {
  const items = visibleNav(MODULES, "admin");
  const shell = shellFor("technician");
  const drawn = drawnNav(items, "technician");
  return (
    <div className="lx-app">
      <header className="lx-top">
        <div className="lx-wordmark" title={ORG.name}>
          <FirmWordmark org={ORG} />
        </div>
        <SectionLabel />
        <div style={{ flex: 1 }} />
        <BellPopover count={{ status: "ok", unread: 3 }} list={{ status: "ok", rows: [] }} />
        <AccountMenu initials="TA" name="Taylor Avery" email="taylor@rpb.example" role="admin" firmName={ORG.name} activeOrgId={ORG.id} switchableFirms={[]} viewMenu={undefined} settingsInMenu={shell.settingsInMenu} variant={shell.variant} />
      </header>
      <div className="lx-main">
        <Rail items={drawn} queueStatus="ok" pendingCount={pendingCount} counts={{}} initialPinned showSettings={shell.showSettings} showReports={shell.showReports} tree={shell.tree} variant={shell.variant} />
        <div className="lx-content">
          <div className="lx-page">{children}</div>
        </div>
      </div>
      <MobileBar items={drawn} queueStatus="ok" pendingCount={pendingCount} counts={{}} bar={shell.bar} groups={shell.moreGroups} variant={shell.variant} />
    </div>
  );
}
