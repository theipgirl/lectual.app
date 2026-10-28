import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MOBILE_BAR, mobileBarItems, moreSections, visibleNav } from "@/lib/nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard/matters/" }));

import { MobileBar, MoreSheet } from "@/components/shell/MobileBar";

const ALL = ["mailbox", "agents", "proposals", "document-center", "agent-toolkit"];
const bar = (modules: string[], role = "owner") => mobileBarItems(visibleNav(modules, role as never), "/dashboard/");
const more = (modules: string[], role = "owner") => moreSections(visibleNav(modules, role as never), "/dashboard/");
const moreLabels = (modules: string[]) => more(modules).flatMap((g) => g.items.map((i) => i.label));

describe("the phone bar (F6)", () => {
  it("starts on Today: Today, Leads, Approvals, Mail with the mailbox module", () => {
    expect(MOBILE_BAR).toEqual(["", "intake", "queue", "mail", "matters"]);
    expect(bar(ALL).map((i) => i.label)).toEqual(["Today", "Leads", "Approvals", "Mail"]);
    expect(bar(ALL).map((i) => i.href)).toEqual(["/dashboard/", "/dashboard/intake/", "/dashboard/queue/", "/dashboard/mail/"]);
  });

  it("Matters takes Mail's slot without the mailbox module, and never offers Mail in the sheet either (fails closed)", () => {
    expect(bar([]).map((i) => i.label)).toEqual(["Today", "Leads", "Approvals", "Matters"]);
    expect(moreLabels([])).not.toContain("My Mail");
    expect(moreLabels([])).not.toContain("All matters");
  });

  it("Matters moves into the sheet when Mail shows, and Today is active on /dashboard/ only", () => {
    expect(moreLabels(ALL)).toContain("Matters");
    expect(bar(ALL).find((i) => i.slug === "")?.active).toBe(true);
    const onMatters = mobileBarItems(visibleNav(ALL, "owner"), "/dashboard/matters/");
    expect(onMatters.find((i) => i.slug === "")?.active).toBe(false);
  });

  it("the sheet carries everything else, only if visible", () => {
    expect(moreLabels(ALL)).toEqual([
      "Calendar", "Meetings", "Campaigns", "Forms", "Client proposals", "Matters", "Pipeline", "Documents",
      "Copilot", "Assistants", "Shortcuts", "Firm notes", "Communication", "Leads", "Active matters", "AI tools", "Settings",
    ]);
    const bare = moreLabels([]);
    for (const gated of ["Assistants", "Shortcuts", "Client proposals"]) expect(bare).not.toContain(gated);
    expect(bare).toContain("Meetings");
    expect(bare).toContain("Settings");
  });

  it("is grouped by the rail's group labels, and nothing is in both the bar and the sheet", () => {
    expect(more(ALL).map((g) => g.label)).toEqual(["Workspace", "Communication", "Leads", "Active matters", "AI tools", "Reports", "Firm"]);
    const inBar = new Set(bar(ALL).map((i) => i.slug));
    for (const g of more(ALL)) for (const i of g.items) expect(inBar.has(i.slug)).toBe(false);
  });

  it("Meetings and Calendar are one tap on More plus one: in the sheet, with direct links", () => {
    const flat = more([]).flatMap((g) => g.items);
    expect(flat.find((i) => i.slug === "meetings")?.href).toBe("/dashboard/meetings/");
    expect(flat.find((i) => i.slug === "calendar")?.href).toBe("/dashboard/calendar/");
  });

  it("only the sheet's Reports group links to report pages", () => {
    for (const href of bar(ALL).map((i) => i.href)) expect(href).not.toContain("/reports/");
    for (const g of more(ALL)) for (const i of g.items) expect(i.href.includes("/reports/")).toBe(g.label === "Reports");
  });
});

describe("rendering (F6)", () => {
  const render = (modules: string[], queueStatus: "ok" | "unconfigured" | "unavailable" = "ok", pendingCount = 2) =>
    renderToStaticMarkup(createElement(MobileBar, { items: visibleNav(modules, "owner"), queueStatus, pendingCount, counts: {} }));

  it("draws a visible text label under every button, and a More button that opens a dialog", () => {
    const html = render(ALL);
    for (const l of ["Today", "Leads", "Approvals", "Mail", "More"]) expect(html).toContain(`<span class="lx-mbar-label">${l}</span>`);
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"[^>]*aria-controls="lx-more-sheet"/);
    expect(html).not.toContain('role="dialog"');
  });

  it("marks the current section", () => {
    // The mocked path is a matter page; with Mail on the bar, Matters lives in the sheet, so More is the active button.
    expect(render(ALL)).toMatch(/<button type="button" class="lx-mbar-item is-active"/);
    expect(render([])).toMatch(/class="lx-mbar-item is-active"[^>]*aria-current="page"/);
  });

  it("keeps the queue's three states on Approvals", () => {
    expect(render(ALL, "ok", 2)).toContain('lx-mbar-badge">2<');
    expect(render(ALL, "unavailable")).toContain('lx-mbar-badge is-alert">!<');
    expect(render(ALL, "unconfigured", 5)).not.toContain("lx-mbar-badge");
  });

  it("the sheet is a modal dialog with grouped links", () => {
    const html = renderToStaticMarkup(createElement(MoreSheet, { sections: more(ALL), onClose: () => {} }));
    expect(html).toContain('role="dialog" aria-modal="true" aria-label="More"');
    expect(html).toContain("lx-more-label");
    expect(html).toMatch(/href="\/dashboard\/calendar\/?"/);
    expect(html).toMatch(/href="\/dashboard\/settings\/?"/);
  });
});

describe("the scrim (F6)", () => {
  it("an outside tap closes the sheet and returns focus to the More button", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/shell/MobileBar.tsx", "utf8");
    expect(src).toMatch(/className="lx-more-scrim" onPointerDown=\{\(\) => close\(true\)\}/);
  });
});
