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
  it("starts on Today: Today, Intake, Approvals, Mail with the mailbox module", () => {
    expect(MOBILE_BAR).toEqual(["", "intake", "queue", "mail", "matters"]);
    expect(bar(ALL).map((i) => i.label)).toEqual(["Today", "Intake", "Approvals", "Mail"]);
    expect(bar(ALL).map((i) => i.href)).toEqual(["/dashboard/", "/dashboard/intake/?view=table", "/dashboard/queue/", "/dashboard/mail/"]);
  });

  it("Matters takes Mail's slot without the mailbox module, and never offers Mail in the sheet either (fails closed)", () => {
    expect(bar([]).map((i) => i.label)).toEqual(["Today", "Intake", "Approvals", "Matters"]);
    expect(moreLabels([])).not.toContain("Mail");
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
      "Weekly review", "Calendar", "Meetings", "Campaigns", "Forms", "Proposals", "Matters", "Pipeline", "Documents",
      "Copilot", "Assistants", "Shortcuts", "Firm notes", "Communication", "Intake", "Active matters", "AI tools", "Settings",
    ]);
    const bare = moreLabels([]);
    for (const gated of ["Assistants", "Shortcuts"]) expect(bare).not.toContain(gated);
    // Both proposal pages are named "Proposals" now, so the gate is checked by section, not by name: the module's page is absent without it.
    const slugs = more([]).flatMap((g) => g.items.map((i) => i.slug));
    expect(slugs).not.toContain("proposals");
    expect(more(ALL).flatMap((g) => g.items.map((i) => i.slug))).toContain("proposals");
    expect(bare).toContain("Meetings");
    expect(bare).toContain("Settings");
  });

  it("is grouped by the rail's group labels, and nothing is in both the bar and the sheet", () => {
    expect(more(ALL).map((g) => g.label)).toEqual(["Workspace", "Communication", "Intake", "Active matters", "AI tools", "Reports", "Firm"]);
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
    for (const l of ["Today", "Intake", "Approvals", "Mail", "More"]) expect(html).toContain(`<span class="lx-mbar-label">${l}</span>`);
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

describe("the scrim and the sheet's keys (F6, design Area G)", () => {
  it("an outside tap closes the sheet; the sheet's own dialog hook returns focus to the More button", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/components/shell/MobileBar.tsx", "utf8");
    expect(src).toMatch(/className="lx-more-scrim" onPointerDown=\{\(\) => setOpen\(false\)\}/);
    // Esc, the Tab trap and focus back to the opener are the shared dialog hook's, not a copy.
    expect(src).toContain("useDialogKeys(ref, { onClose })");
  });

  it("the sheet has its own Close control and a title", () => {
    const html = renderToStaticMarkup(createElement(MoreSheet, { sections: more(ALL), onClose: () => {} }));
    expect(html).toContain('<header class="lx-more-head">');
    expect(html).toMatch(/<button type="button" class="lx-close" aria-label="Close"/);
    expect(html).toContain('tabindex="-1"');
  });

  it("a phone bar label may take two lines and never drops under the 14px floor", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/app/globals.css", "utf8");
    const rule = css.match(/\.lx-mbar-label \{([^}]*)\}/)?.[1] ?? "";
    expect(rule).toContain("font-size: var(--fs-2)");
    expect(rule).toContain("white-space: normal");
    expect(rule).not.toContain("nowrap");
  });
});

describe("a view's own bar and sheet (Phase 1 owner view)", () => {
  const OWNER_BAR = { slugs: ["", "queue", "review", "proposals", "quotes"], labels: { "": "Today", queue: "Approvals", review: "Review", proposals: "Proposals", quotes: "Proposals" } };
  const GROUPS = [{ label: "More", slugs: ["intake", "matters", "calendar"] }];

  it("without the new params the bar and sheet are exactly today's", () => {
    const items = visibleNav(ALL, "owner");
    expect(mobileBarItems(items, "/dashboard/", undefined)).toEqual(bar(ALL));
    expect(moreSections(items, "/dashboard/", undefined, undefined)).toEqual(more(ALL));
  });

  it("a given bar is still filtered through what the firm and role may see", () => {
    expect(mobileBarItems(visibleNav(ALL, "owner"), "/dashboard/", OWNER_BAR).map((i) => i.label)).toEqual(["Today", "Approvals", "Review", "Proposals"]);
    expect(mobileBarItems(visibleNav([], "owner"), "/dashboard/", OWNER_BAR).map((i) => i.slug)).toEqual(["", "queue", "review", "quotes"]);
  });

  it("given groups are drawn as given, with no Reports group and nothing from the bar", () => {
    const sheet = moreSections(visibleNav(ALL, "owner"), "/dashboard/", GROUPS, OWNER_BAR);
    expect(sheet).toEqual([{ label: "More", items: expect.any(Array) }]);
    expect(sheet[0].items.map((i) => i.label)).toEqual(["Intake", "Matters", "Calendar"]);
  });

  it("the owner variant keeps the real bar's markup and adds only its class", () => {
    const items = visibleNav(ALL, "owner");
    const html = renderToStaticMarkup(createElement(MobileBar, { items, queueStatus: "ok", pendingCount: 4, counts: {}, bar: OWNER_BAR, groups: GROUPS, variant: "owner" }));
    expect(html).toContain('class="lx-mbar lx-mbar--owner"');
    expect(html).toContain('<span class="lx-mbar-badge">4</span>');
    expect(renderToStaticMarkup(createElement(MobileBar, { items, queueStatus: "ok", pendingCount: 4, counts: {} }))).toContain('class="lx-mbar"');
  });
});
