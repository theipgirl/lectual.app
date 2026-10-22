import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/lib/onboarding/actions", () => ({ markTourSeenAction: vi.fn() }));

import { OnboardingTour, TourView } from "@/components/onboarding/OnboardingTour";
import { tourSteps } from "@/lib/onboarding/tour";
import { SETUP_PATH } from "@/lib/setup/routes";
import { visibleNav } from "@/lib/nav";

const MODULES = ["agents", "proposals"];
const stepsFor = (role: string, aiConfigured = true, nav = visibleNav(MODULES, role as never)) =>
  tourSteps({ role, navItems: nav, aiConfigured, firmName: "Hartwell IP" });
const noop = () => {};
const view = (steps: ReturnType<typeof stepsFor>, index: number, placement: Parameters<typeof TourView>[0]["placement"] = { mode: "center" }) =>
  renderToStaticMarkup(createElement(TourView, { steps, index, placement, onNext: noop, onBack: noop, onSkip: noop, onLink: noop }));

describe("TourView", () => {
  const owner = stepsFor("owner");

  it("renders a labelled modal dialog with the real step count", () => {
    const html = view(owner, 2);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain(`Step 3 of ${owner.length}`);
    const labelled = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(labelled).toBeTruthy();
    expect(html).toContain(`<h2 id="${labelled}"`);
    expect(html).toContain(owner[2].title);
    expect(html).toContain(">Back<");
    expect(html).toContain(">Next<");
    expect(html).toContain(">Skip tour<");
  });

  it("marks exactly the current dot", () => {
    const html = view(owner, 3);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect((html.match(/class="ot-dot"/g) ?? []).length).toBe(owner.length);
  });

  it("has no Back on the first step", () => {
    expect(view(owner, 0)).not.toContain(">Back<");
  });

  it("swaps Next for Done on the last step, where Done is the only close", () => {
    const html = view(owner, owner.length - 1);
    expect(html).toContain(">Done<");
    expect(html).not.toContain(">Next<");
    expect(html).not.toContain("Skip tour");
  });

  it("the counter follows the filtered count", () => {
    const small = stepsFor("viewer", false, [{ slug: "" }, { slug: "settings" }] as never);
    expect(small.length).toBeLessThan(owner.length);
    expect(view(small, 0)).toContain(`Step 1 of ${small.length}`);
    expect(view(owner, 0)).toContain(`Step 1 of ${owner.length}`);
  });

  it("shows the setup link as a plain link", () => {
    const html = view(owner, owner.findIndex((s) => s.id === "setup"));
    expect(html).toContain(`<a class="ot-link" href="${SETUP_PATH}"`);
    expect(html).not.toContain("<form");
  });

  it("draws a spotlight and a positioned popover, or a centered card", () => {
    const spot = view(owner, 1, { mode: "spot", cutout: { top: 1, left: 2, width: 3, height: 4 }, popover: { top: 10, left: 20, side: "right" } });
    expect(spot).toContain('class="ot-spot"');
    expect(spot).toContain("top:10px;left:20px");
    const center = view(owner, 1);
    expect(center).not.toContain("ot-spot");
    expect(center).toContain("is-centered");
  });

  it("only uses buttons and links, and renders nothing for no steps", () => {
    expect(view([], 0)).toBe("");
    expect(view(owner, 1)).not.toMatch(/<div[^>]*onclick/i);
  });
});

describe("OnboardingTour", () => {
  it("renders nothing until it has opened (closed on the server)", () => {
    const html = renderToStaticMarkup(createElement(OnboardingTour, { open: true, role: "owner", navSlugs: [""], firmName: "F", aiConfigured: true }));
    expect(html).toBe("");
  });
});

describe("component source", () => {
  const src = readFileSync("src/components/onboarding/OnboardingTour.tsx", "utf8");
  const css = readFileSync("src/components/onboarding/tour.css", "utf8");

  it("pairs every listener it adds with a removal", () => {
    for (const ev of ["resize", "scroll", "keydown", "SHOW_TOUR_EVENT"]) {
      const adds = src.split(`addEventListener(${ev.startsWith("SHOW") ? ev : `"${ev}"`}`).length - 1;
      const removes = src.split(`removeEventListener(${ev.startsWith("SHOW") ? ev : `"${ev}"`}`).length - 1;
      expect(adds, ev).toBeGreaterThan(0);
      expect(removes, ev).toBe(adds);
    }
    expect(src).toContain('addEventListener("scroll", measure, true)');
    expect(src).toContain('removeEventListener("scroll", measure, true)');
  });

  it("guards its DOM lookups and uses the shared focus selector", () => {
    expect(src).toMatch(/const el = step\.target \? document\.querySelector/);
    expect(src).toContain("el ? measureTarget(el) : null");
    expect(src).toContain("FOCUSABLE_SELECTOR");
    expect(src).not.toMatch(/a\[href\], button:not/);
  });

  it("moves focus in, and gives it back on close", () => {
    expect(src).toContain("returnTo.current = document.activeElement");
    expect(src).toContain("focusRestoreTarget(returnTo.current)?.focus()");
    expect(src).toMatch(/nextRef\.current \?\? popRef\.current\)\?\.focus\(\)/);
  });

  it("gives the backdrop no click handler", () => {
    const backdrop = /<div className=\{`ot-backdrop[^>]*>/.exec(src)?.[0] ?? "";
    expect(backdrop).toBeTruthy();
    expect(backdrop).not.toContain("onClick");
  });

  it("has a reduced-motion block that removes transitions and animations", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\}/.exec(css)?.[0] ?? "";
    expect(block).toContain("transition: none");
    expect(block).toContain("animation: none");
  });

  it("styles with tokens and existing button classes only", () => {
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(css).not.toContain("font-family: \"");
    expect(css).not.toMatch(/font-family:(?!\s*var\()/);
    expect(css).toContain("var(--");
    expect(src).toMatch(/lx-btn-pri lx-btn-sm/);
    expect(src).toContain("lx-btn-sec");
    expect(src).toContain("lx-btn-ghost");
  });

  it("has no placeholder words", () => {
    for (const text of [src, css]) expect(text).not.toMatch(/coming soon|lorem|todo|placeholder/i);
  });
});
