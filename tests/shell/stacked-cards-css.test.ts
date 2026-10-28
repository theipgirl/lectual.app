import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const globals = read("src/app/globals.css");
const listPage = read("src/components/list-page/list-page.css");
const proposals = read("src/app/dashboard/proposals/proposals.css");
const setup = read("src/components/setup/setup.css");
const hub = read("src/components/onboarding/hub.css");
const copilot = read("src/components/copilot/copilot.css");

/** The body of the first `@media (<query>)` block, by brace matching. */
function media(css: string, query: string, from = 0): string {
  const at = css.indexOf(`@media (${query})`, from);
  expect(at, `@media (${query})`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", at) + 1, i);
  }
  throw new Error("unclosed media block");
}

describe("stacked cards under 640px (V1)", () => {
  const small = media(globals, "max-width: 640px");

  it("rows become blocks, cells show their data-label, the header stays for screen readers", () => {
    expect(small).toMatch(/\.lx-stack:not\(\.pq-tbl\) tr \{ display: block/);
    expect(small).toContain(".lx-stack td[data-label]::before");
    expect(small).toContain("content: attr(data-label)");
    expect(small).toMatch(/\.lx-stack thead \{ position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect\(0 0 0 0\)/);
    expect(small).not.toMatch(/\.lx-stack[^{]*thead[^{]*\{[^}]*display:\s*none/);
  });

  it("a stacked row's fixed height is reset so cards grow to fit (Matters .lp-row)", () => {
    expect(small).toMatch(/\.lx-stack:not\(\.pq-tbl\) tr \{ height: auto;/);
    expect(listPage).toMatch(/\.lp-row \{ height: var\(--lp-row-h\)/);
  });

  it("the leads grid stacks the same way", () => {
    const lp = media(listPage, "max-width: 640px", listPage.indexOf("Leads table: wide keeps"));
    expect(lp).toContain(".lp-table-min { min-width: 0; width: 100%; }");
    expect(lp).toMatch(/\.lp-row-grid \{\s*display: block !important/);
    expect(lp).toContain("content: attr(data-label)");
    expect(lp).toMatch(/\.lp-table-head \{ position: absolute; width: 1px; height: 1px/);
  });

  it("proposals keep their grid card, now with labels", () => {
    const p = media(proposals, "max-width: 760px", proposals.indexOf("Under 760px a row is a stack"));
    expect(p).toContain(".pq-tbl { min-width: 0; display: block; }");
    expect(p).toContain("content: attr(data-label)");
  });

  it("the minimum widths apply only above the stacking widths", () => {
    expect(globals).toMatch(/@media \(min-width: 641px\) \{\s*\.lx-band \.lx-tbl \{ table-layout: fixed; min-width: 760px; \}/);
    expect(listPage).toMatch(/@media \(min-width: 641px\) \{\s*\.lp-table-min \{ min-width: 1000px; \}/);
    expect(proposals).toMatch(/@media \(min-width: 761px\) \{\s*\.pq-tbl \{ min-width: 980px; \}/);
    expect(read("src/app/dashboard/forms/forms.css")).toMatch(/@media \(min-width: 641px\) \{\s*\.ifm-tbl \{\s*min-width: 760px;/);
    for (const f of ["src/app/dashboard/documents/page.tsx", "src/app/dashboard/intake/_components/IntakeTable.tsx"]) expect(read(f), f).not.toMatch(/minWidth:\s*(720|1000|MIN_TABLE_WIDTH)/);
  });

  it("each of the five tables carries the stack class and a data-label on its cells", () => {
    const sources: [string, string[]][] = [
      ["src/app/dashboard/matters/page.tsx", ["Type", "Stage", "In stage", "Owner", "Status"]],
      ["src/app/dashboard/documents/page.tsx", ["Matter", "Status", "Updated"]],
      ["src/app/dashboard/queue/page.tsx", ["Client", "From", "Status", "Queued"]],
      ["src/components/proposal-list/ProposalsTable.tsx", ["Accepted", "Paid", "At signing", "At filing", "Expires", "Last activity"]],
      ["src/app/dashboard/intake/_components/IntakeTable.tsx", ["Stage", "Temperature", "Source", "Owner", "Last touch", "Next step"]],
    ];
    for (const [file, labels] of sources) {
      const src = read(file);
      if (!file.includes("IntakeTable")) expect(src, file).toContain("lx-stack");
      for (const l of labels) expect(src, `${file} ${l}`).toContain(`data-label="${l}"`);
    }
  });
});

describe("no sideways scroll at 375px (V3)", () => {
  const small = media(globals, "max-width: 640px");
  it("clips the page and lets the content shrink", () => {
    expect(small).toMatch(/html,\s*body \{ overflow-x: clip; \}/);
    expect(small).toMatch(/\.lx-page,\s*\.lx-content \{ min-width: 0; overflow-x: clip; \}/);
  });
  it("sets no fixed width over 375px in the mobile table rules", () => {
    const rules = [small, media(listPage, "max-width: 640px", listPage.indexOf("Leads table: wide keeps")), media(proposals, "max-width: 760px", proposals.indexOf("Under 760px a row is a stack"))];
    for (const r of rules) for (const m of r.matchAll(/(?<![-\w])(?:min-)?width:\s*(\d+)px/g)) expect(Number(m[1]), m[0]).toBeLessThanOrEqual(375);
  });
});

describe("touch targets (V2)", () => {
  it("coarse pointers get 44px on buttons, nav, chips and menu items", () => {
    const coarse = media(globals, "pointer: coarse");
    for (const sel of [".lx-btn", ".lx-fi", ".lx-mbar-item", ".lx-more-link", ".lx-rail-item", ".lx-avatar"]) expect(coarse, sel).toContain(sel);
    for (const sel of [".lx-toggle", ".lx-lv button", ".lx-chips a", ".lx-tbl td a"]) expect(coarse, sel).toContain(sel);
    expect(coarse).not.toMatch(/\.lx-chip[,\s{]/);
    expect(coarse).toContain("min-height: 44px; min-width: 44px");
    expect(media(listPage, "pointer: coarse")).toContain("min-height: 44px");
  });
  it("the phone bar items are at least 44px and nothing is sized 42px any more", () => {
    expect(globals).toMatch(/\.lx-mbar-item \{[^}]*min-height: 48px/);
    expect(globals).not.toMatch(/(width|height): 42px/);
  });
  it("the bar is drawn only under 900px", () => {
    expect(globals).toMatch(/\.lx-mbar,\s*\.lx-more,\s*\.lx-more-scrim \{ display: none; \}/);
  });
});

describe("Setup at 720px and under (V4)", () => {
  it("label and why sit in column 2, with the pill and the button following", () => {
    const m = media(setup, "max-width: 720px");
    expect(m).toMatch(/\.su-item > div,\s*\.su-item > \.su-state,\s*\.su-item > \.su-action \{\s*grid-column: 2;/);
    expect(m).toContain("grid-template-columns: 24px minmax(0, 1fr)");
  });
  it("the markup order is label, pill, action", () => {
    const view = read("src/components/setup/SetupChecklistView.tsx");
    const at = (s: string) => view.indexOf(s);
    expect(at('className="su-text"')).toBeLessThan(at('className="su-state"'));
    expect(at('className="su-state"')).toBeLessThan(at('className="su-action"'));
  });
});

describe("Getting started on a phone (V5)", () => {
  it("at 560px and under a flow is a 22px column and the button takes its own row in column 2", () => {
    const m = media(hub, "max-width: 560px");
    expect(m).toContain("grid-template-columns: 22px 1fr;");
    expect(m).toMatch(/\.gs-flow > \.lx-btn \{\s*grid-column: 2;/);
  });
  it("the done check uses --ok", () => {
    expect(hub).toMatch(/\.gs-check\.is-done \{\s*background: var\(--ok\);/);
  });
});

describe("Settings list on a phone (V6)", () => {
  it("lies down as a horizontally scrolling strip with the current tab underlined", () => {
    const m = media(globals, "max-width: 900px", globals.indexOf(".lx-settings-nav {\n    display: flex") - 400);
    expect(m).toContain("overflow-x: auto");
    expect(m).toMatch(/\.lx-settings-nav \.lx-fi\[aria-current="page"\] \{[^}]*border-bottom-color: var\(--ox\)/);
  });
  it("the nav marks the current tab with aria-current", () => {
    expect(read("src/components/settings/SettingsNav.tsx")).toContain('aria-current={path.startsWith');
  });
});

describe("the Copilot launcher and a sticky Save bar (P4)", () => {
  it("lifts above a marked bar on wide screens and hides on phones", () => {
    expect(copilot).toContain("body:has([data-save-bar]) .cpd-launcher { bottom: 86px; }");
    expect(media(copilot, "max-width: 640px")).toContain("body:has([data-save-bar]) .cpd-launcher { display: none; }");
  });
  it("the sticky Unsaved changes bar is marked", () => {
    expect(read("src/app/dashboard/forms/_components/IntakeFormsWorkspace.tsx")).toContain('className="ifm-unsaved" data-save-bar');
  });
  it("the Esc hint shows only from 900px up", () => {
    expect(copilot).toMatch(/\.cpd-kbd \{\s*display: none;/);
    expect(media(copilot, "min-width: 900px")).toContain(".cpd-kbd { display: inline; }");
  });
});

describe("tokens and no emoji (V7)", () => {
  it("the new blocks use var(--...) colours, no hex of their own", () => {
    const added = globals.slice(globals.indexOf("/* Phone (under 900px)"), globals.indexOf("/* ── Meetings")) + globals.slice(globals.indexOf("Small screens (Sprint 32)"));
    // The phone bar uses the rail's own glass rgba values; no hex colour appears.
    expect(added).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(setup + hub).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});
