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
  it("lists Leads, Approvals, Mail and Matters in order", () => {
    expect(MOBILE_BAR).toEqual(["intake", "queue", "mail", "matters"]);
    expect(bar(ALL).map((i) => i.label)).toEqual(["Leads", "Approvals", "Mail", "Matters"]);
    expect(bar(ALL).map((i) => i.href)).toEqual(["/dashboard/intake/", "/dashboard/queue/", "/dashboard/mail/", "/dashboard/matters/"]);
  });

  it("omits Mail without the mailbox module and never offers it in the sheet either (fails closed)", () => {
    expect(bar([]).map((i) => i.label)).toEqual(["Leads", "Approvals", "Matters"]);
    expect(moreLabels([])).not.toContain("My Mail");
  });

  it("the sheet carries everything else, only if visible", () => {
    expect(moreLabels(ALL)).toEqual([
      "Today", "Calendar", "Meetings", "Campaigns", "Intake forms", "Client proposals", "Pipeline", "Documents",
      "Copilot", "Assistants", "Shortcuts", "Firm notes", "Settings",
    ]);
    const bare = moreLabels([]);
    for (const gated of ["Assistants", "Shortcuts", "Client proposals"]) expect(bare).not.toContain(gated);
    expect(bare).toContain("Meetings");
    expect(bare).toContain("Settings");
  });

  it("is grouped by the rail's group labels, and nothing is in both the bar and the sheet", () => {
    expect(more(ALL).map((g) => g.label)).toEqual(["Workspace", "Communication", "Leads", "Active matters", "AI tools", "Firm"]);
    const inBar = new Set(bar(ALL).map((i) => i.slug));
    for (const g of more(ALL)) for (const i of g.items) expect(inBar.has(i.slug)).toBe(false);
  });

  it("Meetings and Calendar are one tap on More plus one: in the sheet, with direct links", () => {
    const flat = more([]).flatMap((g) => g.items);
    expect(flat.find((i) => i.slug === "meetings")?.href).toBe("/dashboard/meetings/");
    expect(flat.find((i) => i.slug === "calendar")?.href).toBe("/dashboard/calendar/");
  });

  it("no link on the bar or sheet is a report page", () => {
    for (const href of [...bar(ALL).map((i) => i.href), ...more(ALL).flatMap((g) => g.items.map((i) => i.href))]) expect(href).not.toContain("/reports/");
  });
});

describe("rendering (F6)", () => {
  const render = (modules: string[], queueStatus: "ok" | "unconfigured" | "unavailable" = "ok", pendingCount = 2) =>
    renderToStaticMarkup(createElement(MobileBar, { items: visibleNav(modules, "owner"), queueStatus, pendingCount, counts: {} }));

  it("draws a visible text label under every button, and a More button that opens a dialog", () => {
    const html = render(ALL);
    for (const l of ["Leads", "Approvals", "Mail", "Matters", "More"]) expect(html).toContain(`<span class="lx-mbar-label">${l}</span>`);
    expect(html).toMatch(/<button[^>]*aria-haspopup="dialog"[^>]*aria-expanded="false"[^>]*aria-controls="lx-more-sheet"/);
    expect(html).not.toContain('role="dialog"');
  });

  it("marks the current section", () => {
    expect(render(ALL)).toMatch(/aria-current="page"[^>]*>|class="lx-mbar-item is-active"[^>]*aria-current="page"/);
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
