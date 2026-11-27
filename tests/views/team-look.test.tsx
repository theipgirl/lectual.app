import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/auth/actions", () => ({ signOutAction: async () => {}, switchFirmAction: async () => ({}) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/", useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { visibleNav } from "@/lib/nav";
import { Rail } from "@/components/shell/Rail";
import { MobileBar } from "@/components/shell/MobileBar";
import { AccountMenu } from "@/components/shell/AccountMenu";
import { drawnNav, shellFor } from "@/lib/views";
import { guideFor } from "@/lib/onboarding/welcome-deal";

const ALL = ["mailbox", "agents", "proposals", "document-center", "agent-toolkit", "role-views"];
const base = { queueStatus: "ok" as const, pendingCount: 3, counts: {} };
const menuProps = { initials: "AB", name: "Ann B", email: "a@firm.test", role: "paralegal", firmName: "Firm", activeOrgId: "o1", switchableFirms: [] };

describe("team view: the owner's look, none of its behaviours", () => {
  const shell = shellFor("team");
  const drawn = drawnNav(visibleNav(ALL, "paralegal"), "team");

  it("the shell spec carries the look but not the owner variant", () => {
    expect(shell.look).toBe("team");
    expect(shell.variant).toBeUndefined();
    expect(shellFor("owner")).toMatchObject({ look: "owner", variant: "owner" });
    expect(shellFor("technician")).toMatchObject({ look: undefined, variant: undefined });
  });

  it("rail: owner styling class, only the four rows, no More, Reports or Settings", () => {
    const html = renderToStaticMarkup(createElement(Rail, { ...base, items: drawn, initialPinned: true, tree: shell.tree, showSettings: false, showReports: false, look: shell.look, variant: shell.variant, dealReady: "Your 2:00 PM deal is ready · 3 cards" }));
    expect(html).toContain("lx-rail--owner");
    expect(html).toContain("lx-rail--team");
    for (const l of ["Today", "Weekly review", "Matters", "Approvals"]) expect(html).toContain(l);
    for (const gone of ["More", "Reports", "Settings", "lx-rail-chev"]) expect(html, gone).not.toContain(gone);
    expect((html.match(/class="lx-rail-item/g) ?? []).length).toBe(4);
    // Owner-only behaviour: the deal-ready dot is never drawn for the look alone, even when a nudge were passed.
    expect(html).not.toContain("is-ready");
    expect(html).not.toContain("lx-ready-dot");
    expect(html).not.toContain("deal is ready");
    expect(html).not.toContain("Owner view");
  });

  it("phone bar: owner pill-bar class, Today / Review / Matters / Approvals, no More, no deal dot", () => {
    const html = renderToStaticMarkup(createElement(MobileBar, { ...base, items: drawn, bar: shell.bar, groups: shell.moreGroups, reports: shell.showReports, more: shell.showMore, look: shell.look, variant: shell.variant, dealReady: "ready" }));
    expect(html).toContain("lx-mbar lx-mbar--owner lx-mbar--team");
    for (const l of ["Today", "Review", "Matters", "Approvals"]) expect(html).toContain(l);
    expect(html).not.toContain("More");
    expect(html).not.toContain("lx-ready-dot");
  });

  it("owner rail and bar keep their exact classes (no team marker)", () => {
    const o = shellFor("owner");
    const items = drawnNav(visibleNav(ALL, "owner"), "owner");
    const rail = renderToStaticMarkup(createElement(Rail, { ...base, items, initialPinned: true, tree: o.tree, look: o.look, variant: o.variant }));
    expect(rail).toContain("lx-rail--owner");
    expect(rail).not.toContain("lx-rail--team");
    const bar = renderToStaticMarkup(createElement(MobileBar, { ...base, items, bar: o.bar, groups: o.moreGroups, look: o.look, variant: o.variant }));
    expect(bar).toContain('class="lx-mbar lx-mbar--owner"');
  });

  it("account menu: the owner layout, Settings and help reachable, no deal times; the technician menu is unchanged", () => {
    const team = renderToStaticMarkup(createElement(AccountMenu, { ...menuProps, settingsInMenu: true, look: "team" }));
    expect(team).toContain("lx-am-head");
    expect(team).toMatch(/href="\/dashboard\/settings\/?"/);
    expect(team).toContain("Getting started");
    expect(team).toContain("Show tips again");
    expect(team).toContain("Send feedback");
    expect(team).toContain("Sign out");
    expect(team).not.toMatch(/deal times|Deal times|View as/);
    const owner = renderToStaticMarkup(createElement(AccountMenu, { ...menuProps, role: "owner", settingsInMenu: true, variant: "owner", look: "owner" }));
    expect(owner).toMatch(/[Dd]eal times/);
    const tech = renderToStaticMarkup(createElement(AccountMenu, { ...menuProps }));
    expect(tech).toContain("lx-am-plain");
  });

  it("the first-sign-in guide stays the tour for team (the welcome deal is the owner's alone)", () => {
    expect(guideFor(shell.variant)).toBe("tour");
    expect(guideFor(shellFor("owner").variant)).toBe("welcome");
  });

  it("the phone approval-item layout (review.css) stays the owner's alone", () => {
    const css = readFileSync(path.join(process.cwd(), "src/components/queue/review.css"), "utf8");
    expect(css).not.toMatch(/:has\(\.lx-top--owner\)/);
    expect(css).toContain(":has(.lx-top--owner:not(.lx-top--team))");
  });

  it("the layout reads `look` for drawing and `variant` for behaviour", () => {
    const src = readFileSync(path.join(process.cwd(), "src/app/dashboard/layout.tsx"), "utf8");
    expect(src).toContain("!shell.look && <SectionLabel />");
    expect(src).toContain('shell.variant === "owner" ? loadDealNudge');
    expect(src).toContain('shell.variant === "owner" && <DealTimesDialog');
    expect(src).not.toMatch(/shell\.look === "owner"[^\n]*(loadDealNudge|DealTimesDialog|WelcomeDeal)/);
  });
});
