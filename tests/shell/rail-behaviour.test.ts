import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { closeRailOnEscape, releaseRailFocus } from "@/lib/rail-behaviour";
import { RAIL_PIN_COOKIE } from "@/lib/nav";

const css = readFileSync(path.resolve(__dirname, "../../src/app/globals.css"), "utf8");
const rail = readFileSync(path.resolve(__dirname, "../../src/components/shell/Rail.tsx"), "utf8");

describe("rail CSS (F9)", () => {
  it("no longer opens on :focus-within, and opens on keyboard focus instead", () => {
    expect(css.match(/\.lx-rail:focus-within/g)).toBeNull();
    expect((css.match(/\.lx-rail:has\(:focus-visible\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("hands the phone over to the bottom bar: the rail column is not drawn under 900px (Sprint 32)", () => {
    const phone = css.slice(css.indexOf("/* Phone (under 900px)"));
    expect(phone).toMatch(/\.lx-rail-slot,\s*\.lx-rail-slot\.is-pinned \{ display: none; \}/);
    expect(phone).toContain(".lx-mbar {");
  });

  it("delays the collapse transition by 120-150ms", () => {
    const base = css.match(/\n\.lx-rail \{[^}]*?transition:\s*width\s+[\d.]+s\s+cubic-bezier\([^)]*\)\s+([\d.]+)s;/);
    expect(base).not.toBeNull();
    const ms = parseFloat(base![1]) * 1000;
    expect(ms).toBeGreaterThanOrEqual(120);
    expect(ms).toBeLessThanOrEqual(150);
  });

  it("opens with no delay on hover, keyboard focus and pinned", () => {
    const open = css.match(/\.lx-rail:hover,\n\.lx-rail:has\(:focus-visible\),\n\.lx-rail\.is-pinned \{([^}]*)\}/);
    expect(open).not.toBeNull();
    expect(open![1]).toMatch(/width:\s*262px/);
    expect(open![1]).toMatch(/transition-delay:\s*0s/);
  });
});

describe("rail helpers (F10)", () => {
  const fake = () => ({ blur: vi.fn() });

  it("Escape blurs the focused element inside the rail", () => {
    const active = fake();
    const closed = closeRailOnEscape("Escape", { contains: (n) => n === active }, active);
    expect(closed).toBe(true);
    expect(active.blur).toHaveBeenCalledTimes(1);
  });

  it("ignores every other key", () => {
    for (const key of ["Tab", "Enter", " ", "ArrowDown", "Esc", "escape"]) {
      const active = fake();
      expect(closeRailOnEscape(key, { contains: () => true }, active)).toBe(false);
      expect(active.blur).not.toHaveBeenCalled();
    }
  });

  it("does nothing when focus is outside the rail or nowhere", () => {
    const active = fake();
    expect(closeRailOnEscape("Escape", { contains: () => false }, active)).toBe(false);
    expect(active.blur).not.toHaveBeenCalled();
    expect(closeRailOnEscape("Escape", { contains: () => true }, null)).toBe(false);
    expect(closeRailOnEscape("Escape", { contains: () => true }, undefined)).toBe(false);
  });

  it("a link click blurs the active element, and tolerates none", () => {
    const active = fake();
    releaseRailFocus(active);
    expect(active.blur).toHaveBeenCalledTimes(1);
    expect(() => releaseRailFocus(null)).not.toThrow();
  });

  it("is wired into every rail link, the pin button and the nav", () => {
    expect(rail).toContain("closeRailOnEscape(e.key");
    expect((rail.match(/onClick=\{releaseFocus\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(rail).toContain("releaseFocus()");
  });
});

describe("pinning is unchanged", () => {
  it("keeps the cookie name and the is-pinned markup", () => {
    expect(RAIL_PIN_COOKIE).toBe("lx_rail");
    expect(rail).toContain("is-pinned");
    expect(rail).toContain("RAIL_PIN_COOKIE");
    expect(css).toContain(".lx-rail-slot.is-pinned { width: 294px; }");
  });
});
