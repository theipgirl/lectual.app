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
import type { CustomValue } from "@/lib/custom-columns/rules";

/**
 * The TECHNICIAN shell (no `.lx-top--owner`, default rail and phone bar) around the technician weekly review, so the legibility pass
 * can prove, pixel for pixel against an older commit, that no owner-only rule reaches the technician view. Not a design-board screen.
 */
export function TechShell({ children, railPinned = true }: { children: ReactNode; railPinned?: boolean }) {
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

/** Sprint 2: the firm's own columns on the List (invented data), so the evaluator can look at them at 1440px and 375px. */
const F = { priority: "00000000-0000-4000-8000-00000000c001", review: "00000000-0000-4000-8000-00000000c003", quote: "00000000-0000-4000-8000-00000000c004", reviewer: "00000000-0000-4000-8000-00000000c005" };
const withCustom = () => {
  prepare();
  const rows = state.review.status === "ok" ? state.review.rows : [];
  const lead = rows.find((r) => r.kind === "lead");
  const matter = rows.find((r) => r.kind === "matter");
  const v = (id: string, over: Partial<CustomValue> & { fieldId: string }): CustomValue => ({ id, leadId: null, matterId: null, text: null, date: null, cents: null, choice: null, userId: null, updatedAt: "2026-11-01T10:00:00Z", ...over });
  if (state.review.status === "ok")
    state.review = {
      ...state.review,
      custom: {
        status: "ok",
        fields: [
          { id: F.priority, section: "trademarks", label: "Priority", kind: "choice", position: 0, options: ["High", "Low"] },
          { id: F.review, section: "both", label: "Review cycle", kind: "text", position: 1, options: [] },
          { id: F.quote, section: "trademarks", label: "Quoted fee", kind: "money", position: 2, options: [] },
          { id: F.reviewer, section: "trademarks", label: "Reviewer", kind: "person", position: 3, options: [] },
        ],
        values: [
          ...(lead ? [v("v1", { fieldId: F.priority, leadId: lead.id, choice: "High" }), v("v2", { fieldId: F.reviewer, leadId: lead.id, userId: "no-longer-here" })] : []),
          ...(matter ? [v("v3", { fieldId: F.review, matterId: matter.id, text: "Quarterly" }), v("v4", { fieldId: F.quote, matterId: matter.id, cents: 125000 })] : []),
        ],
        mergedInto: {},
        leadOfMatter: {},
      },
    };
};

export const screens: Screen[] = [
  { ...base, id: "tech-shell-desktop", title: "Technician shell, weekly review board", viewport: "desktop", render: tech({}) },
  { ...base, id: "tech-shell-collapsed", title: "Technician shell, rail collapsed", viewport: "desktop", render: tech({}, false) },
  { ...base, id: "tech-shell-phone", title: "Technician shell, phone", viewport: "phone", render: tech({}) },
  { ...base, id: "tech-shell-sheet", title: "Technician shell, weekly review sheet", viewport: "desktop", render: tech({ view: "sheet" }) },
  { ...base, id: "tech-shell-sheet-custom", title: "Technician shell, weekly review sheet with firm columns", viewport: "desktop", prepare: withCustom, render: tech({ view: "sheet" }) },
  { ...base, id: "tech-shell-sheet-custom-phone", title: "Technician shell, weekly review sheet with firm columns, phone", viewport: "phone", prepare: withCustom, render: tech({ view: "sheet" }) },
];
